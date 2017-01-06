#!/usr/bin/python

"""Select regions of interest centered at surface points with minimum distance to reference surface."""

import os
import sys
import csv
import sqlite3
import argparse

from subprocess import check_output


# Path of select-rois binary built from C++ source file
bindir = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'bin'))


def get_scan_id(db, subject_id, session_id):
    """Get ScanId corresponding to given pair of subject and session IDs."""
    res = db.execute("SELECT ScanId FROM Scans WHERE SubjectId = :subject_id AND SessionId = :session_id",
                     dict(subject_id=subject_id, session_id=session_id)).fetchone()
    if res:
        return res[0]
    else:
        raise Exception("ScanId not found for SubjectId={} and SessionId={}".format(subject_id, session_id))


def options(args, exclude=[]):
    argv = []
    for var in vars(args):
        if var not in exclude:
            argv.append("--{}={}".format(var.replace('_', '-'), getattr(args, var)))
    return argv


def get_or_insert_command_id(db, name, params, print_sql=False):
    """Get ID of previous script execution with identical parameters or insert new record."""
    cur = db.cursor()
    try:
        if isinstance(params, (tuple, list)):
            params = ' '.join(params)
        res = cur.execute("SELECT CommandId FROM Commands WHERE Name = :name AND Parameters = :params",
                          dict(name=name, params=params)).fetchone()
        if res:
            cmd_id = res[0]
        elif print_sql:
            cmd_id = 0
            print("INSERT INTO Commands (Name, Parameters) VALUES ({}, {});".format(name, params))
        else:
            cur.execute(
                "INSERT INTO Commands (Name, Parameters) VALUES (:name, :params)",
                dict(name=name, params=params)
            )
            cmd_id = cur.lastrowid
            if not cmd_id:
                res = cur.execute("SELECT CommandId FROM Commands WHERE Name = :name AND Parameters = :params",
                                  dict(name=name, params=params)).fetchone()
                if res:
                    cmd_id = res[0]
                else:
                    raise Exception("Failed to determine CommandId of newly inserted Commands record: " + name)
    finally:
        cur.close()
    return cmd_id


def insert_roi(db, scan_id, center, span, view=None, cmd_id=0, print_sql=False):
    """Insert new ROI into database."""
    cols = "ScanId, CommandId, CenterX, CenterY, CenterZ, Span"
    vals = ":scan_id, :cmd_id, :x, :y, :z, :span"
    if view:
        cols += ", BestViewId"
        vals += ", :view"
    sql = "INSERT INTO ROIs ({}) VALUES ({})".format(cols, vals)
    par = dict(scan_id=scan_id, cmd_id=cmd_id, x=center[0], y=center[1], z=center[2], span=span, view=view)
    if print_sql:
        for key, value in par.items():
            sql = sql.replace(':' + key, str(value))
        print(sql + ';')
        return 0
    db.execute(sql, par)
    return db.lastrowid


if __name__ == '__main__':
    # parse arguments
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',
                        help="SQLite database file")
    parser.add_argument('--subject',
                        help="Subject ID", required=True)
    parser.add_argument('--session',
                        help="Session ID", required=True)
    parser.add_argument('--surface',
                        help="Surface mesh file", required=True)
    parser.add_argument('--reference',
                        help="Reference surface mesh file")
    parser.add_argument('--image',
                        help="Image used to determine best orthogonal viewing direction")
    parser.add_argument('--mask-name', default='',
                        help="Name of point/cell data mask array")
    parser.add_argument('--mask-erosion', default=0,
                        help="Number of point/cell data mask erosion iterations")
    parser.add_argument('--min-seed-distance', default=1., type=float,
                        help="Minimum distance of cluster seed points")
    parser.add_argument('--distance-threshold-percentile', default=99, type=int,
                        help="Percentile used as lower distance threshold for clustering")
    parser.add_argument('--min-distance-threshold', default=.5, type=float,
                        help="Minimum distance threshold used for clustering")
    parser.add_argument('--min-cluster-size', default=10, type=int,
                        help="Minimum number of points per surface cluster")
    parser.add_argument('--cluster-centers', action='store_true',
                        help="Use cluster centroids as ROI center points")
    parser.add_argument('--roi-span', '--roi-size', '--span', dest='span', default=40., type=float,
                        help="Length of each side of a ROI in mm")
    parser.add_argument('--overlap-span', default=0., type=float,
                        help="Length of each bounding box side used for overlap check in mm")
    parser.add_argument('--max-overlap-ratio', default=.99, type=float,
                        help="Maximum overlap between ROIs at cluster centers")
    parser.add_argument('--random-points-ratio', default=0, type=float,
                        help="Ratio of randomly sampled surface points")
    parser.add_argument('-n', default=0, type=int,
                        help="Number of ROIs to select")
    parser.add_argument('--max', default=0, type=int,
                        help="Maximum number of ROIs to select")
    parser.add_argument('--print-sql', action='store_true',
                        help="Do not insert regions into database, just print SQL statements")
    parser.add_argument('-v', '--verbose', default=0, action='count',
                        help="Verbosity of output messages")
    args = parser.parse_args()
    if args.overlap_span <= 0.:
        args.overlap_span = args.span
    if args.n > 0 and args.max == 0:
        args.max = args.n
    # open database
    db = sqlite3.connect(args.database)
    try:
        # get foreign keys from database
        scan_id = get_scan_id(db, args.subject, args.session)
        cmd_id = get_or_insert_command_id(
            db, name=os.path.basename(__file__), params=options(args, exclude=[
                'database', 'output', 'subject', 'session', 'print_sql', 'verbose'
            ]),
            print_sql=args.print_sql
        )
        # select centers of ROIs
        cmd = [
            os.path.join(bindir, 'select-rois'),
            args.surface, args.reference,
            '-min-distance', args.min_seed_distance,
            '-distance-threshold', args.min_distance_threshold,
            '-distance-threshold-percentile', args.distance_threshold_percentile,
            '-joined-clustering', True,
            '-cluster-centers', args.cluster_centers,
            '-min-cluster-size', args.min_cluster_size,
            '-span', args.overlap_span,
            '-max-overlap-ratio', args.max_overlap_ratio,
            '-num-points', args.n,
            '-max-points', args.max,
            '-random-points-ratio', args.random_points_ratio,
            '-stratified', True,
            '-delim', ','
        ]
        if args.image:
            cmd.extend(['-image', os.path.abspath(args.image)])
        if args.mask_name:
            cmd.extend(['-mask-name', args.mask_name, '-mask-erosion', args.mask_erosion])
        if args.verbose > 1:
            cmd.append('-v')
        cmd = [str(arg) for arg in cmd]
        if args.verbose > 1:
            for arg in cmd:
                arg = arg.replace('"', '\\"')
                arg = arg.replace("'", "\\'")
                if ' ' in arg:
                    arg = '"' + arg + '"'
                sys.stdout.write(arg)
                sys.stdout.write(' ')
            sys.stdout.write('\n\n')
        table = check_output(cmd)
        if args.verbose > 1:
            sys.stdout.write('\n')
            sys.stdout.write(table)
            sys.stdout.write('\n')
        reader = csv.DictReader(table.splitlines())
        points = []
        views = []
        nrandom = 0
        for row in reader:
            if args.cluster_centers:
                x = float(row['CenterX'])
                y = float(row['CenterY'])
                z = float(row['CenterZ'])
            else:
                x = float(row['SeedX'])
                y = float(row['SeedY'])
                z = float(row['SeedZ'])
            points.append((x, y, z))
            try:
                views.append(row['View'])
            except KeyError:
                views.append(None)
            if int(row['ClusterSize']) <= 1:
                nrandom += 1
        if args.verbose > 0:
            print("Selected {} regions of interest, {} randomly".format(len(points), nrandom))
        # write selected regions of interest to database
        cur = db.cursor()
        try:
            for point, view in zip(points, views):
                insert_roi(cur, scan_id=scan_id,
                           center=point, span=args.span, view=view,
                           cmd_id=cmd_id, print_sql=args.print_sql)
            db.commit()
        finally:
            cur.close()
    finally:
        db.close()
