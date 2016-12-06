#!/usr/bin/python

"""Select regions of interest centered at surface points with minimum distance to reference surface."""

import os
import sqlite3
import argparse

from vtk import (vtkXMLPolyDataReader, vtkXMLPolyDataWriter,
                 vtkDistancePolyDataFilter, vtkPolyDataConnectivityFilter, vtkPointDataToCellData,
                 vtkIdList, vtkExtractCells, vtkDataSetSurfaceFilter, vtkMassProperties)


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
    if isinstance(params, (tuple, list)):
        params = ' '.join(params)
    res = db.execute("SELECT CommandId FROM Commands WHERE Name = :name AND Parameters = :params",
                     dict(name=name, params=params)).fetchone()
    if res:
        cmd_id = res[0]
    elif print_sql:
        cmd_id = 0
        print("INSERT INTO Commands (Name, Parameters) VALUES ({}, {});".format(name, params))
    else:
        db.execute(
            "INSERT INTO Commands (Name, Parameters) VALUES (:name, :params)",
            dict(name=name, params=params)
        )
        cmd_id = db.lastrowid
        if not cmd_id:
            res = db.execute("SELECT CommandId FROM Commands WHERE Name = :name AND Parameters = :params",
                             dict(name=name, params=params)).fetchone()
            if res:
                cmd_id = res[0]
            else:
                raise Exception("Failed to determine CommandId of newly inserted Commands record: " + name)
    return cmd_id


def get_max_distance(distances, region_ids, region_id):
    """Get max point distance of specified cluster."""
    d = 0
    i = -1
    for point_id in xrange(region_ids.GetNumberOfTuples()):
        if region_ids.GetComponent(point_id, 0) == float(region_id):
            distance = distances.GetComponent(point_id, 0)
            if distance > d:
                i = int(point_id)
                d = distance
    return (i, d)


def compute_area(surface, region_ids, region_id, cell_data=False):
    """Compute area of specified surface patch."""
    cell_ids = vtkIdList()
    cell_ids.Allocate(surface.GetNumberOfCells())
    if cell_data:
        for cell_id in xrange(surface.GetNumberOfCells()):
            if int(region_ids.GetComponent(cell_id, 0)) == region_id:
                cell_ids.InsertNextId(cell_id)
    else:
        surface.BuildLinks()
        point_ids = vtkIdList()
        point_ids.Allocate(10)
        for cell_id in xrange(surface.GetNumberOfCells()):
            surface.GetCellPoints(cell_id, point_ids)
            exclude = False
            for i in range(point_ids.GetNumberOfIds()):
                point_id = point_ids.GetId(i)
                if int(region_ids.GetComponent(point_id, 0)) != region_id:
                    exclude = True
                    break
            if not exclude:
                cell_ids.InsertNextId(cell_id)
    if cell_ids.GetNumberOfIds() == 0:
        return 0.
    extract = vtkExtractCells()
    extract.SetInputData(surface)
    extract.SetCellList(cell_ids)
    convert = vtkDataSetSurfaceFilter()
    convert.SetInputConnection(extract.GetOutputPort())
    convert.UseStripsOff()
    convert.PassThroughCellIdsOff()
    convert.PassThroughPointIdsOff()
    props = vtkMassProperties()
    props.SetInputConnection(convert.GetOutputPort())
    return props.GetSurfaceArea()


def select_points(surface_name, reference_name, output_name=None,
                  min_distance=1., max_distance=float('inf'),
                  min_patch_size=1, min_patch_area=0.):
    """Select surface points based on minimum distance from reference surface."""
    min_patch_size = max(1, min_patch_size)
    # read input surfaces
    surface_reader = vtkXMLPolyDataReader()
    surface_reader.SetFileName(surface_name)
    surface_reader.UpdateWholeExtent()
    surface = surface_reader.GetOutput()
    surface.GetPointData().Initialize()
    surface.GetCellData().Initialize()
    reference_reader = vtkXMLPolyDataReader()
    reference_reader.SetFileName(reference_name)
    reference_reader.UpdateWholeExtent()
    reference = reference_reader.GetOutput()
    reference.GetPointData().Initialize()
    reference.GetCellData().Initialize()
    # compute inter-surface distance
    calc = vtkDistancePolyDataFilter()
    calc.SetInputData(0, surface)
    calc.SetInputData(1, reference)
    calc.ComputeSecondDistanceOff()
    calc.SignedDistanceOff()
    # cluster cells based on scalar connectivity
    conn = vtkPolyDataConnectivityFilter()
    conn.SetInputConnection(calc.GetOutputPort())
    conn.SetExtractionModeToAllRegions()
    conn.ScalarConnectivityOn()
    conn.FullScalarConnectivityOff()
    conn.SetScalarRange(min_distance, max_distance)
    conn.ColorRegionsOn()
    # convert point data to cell data
    try:
        p2cd = vtkPointDataToCellData()
        p2cd.SetInputConnection(conn.GetOutputPort())
        p2cd.PassPointDataOn()
        p2cd.CategoricalDataOn()  # VTK >= 7.1
        p2cd.Update()
        output = p2cd.GetOutput()
    except:
        conn.Update()
        output = conn.GetOutput()
    # compute area and max distance of each cluster
    if output_name:
        writer = vtkXMLPolyDataWriter()
        writer.SetInputData(output)
        writer.SetFileName(output_name)
        writer.Write()
    point_distances = output.GetPointData().GetArray('Distance')
    region_ids_array = 'RegionId'
    point_region_ids = output.GetPointData().GetArray(region_ids_array)
    region_ids = output.GetCellData().GetArray(region_ids_array)
    if region_ids:
        cell_region_ids = True
    else:
        region_ids = point_region_ids
        cell_region_ids = False
    regions = []
    for region_id in xrange(conn.GetNumberOfExtractedRegions()):
        conn.DeleteSpecifiedRegion(region_id)
        patch_size = conn.GetRegionSizes().GetValue(region_id)
        if patch_size > min_patch_size:
            point_id, d = get_max_distance(point_distances, point_region_ids, region_id)
            if d > min_distance:
                area = compute_area(output, region_ids, region_id, cell_data=cell_region_ids)
                if area > min_patch_area:
                    regions.append((region_id, point_id, d, area))
    # sort regions by maximum distance from reference surface
    regions.sort(key=lambda x: x[3], reverse=True)
    points = []
    p = [0, 0, 0]
    surface = surface_reader.GetOutput()
    for i in xrange(len(regions)):
        surface.GetPoint(regions[i][1], p)
        points.append(tuple(p))
    return points


def get_number_of_rois(db, scan_id):
    """Get number of existing ROIs for a given scan."""
    db.execute("SELECT COUNT(ROI_Id) FROM ROIs WHERE ScanId = :scan_id", {'scan_id': scan_id})
    return int(db.fetchone()[0])


def where_rois_overlap():
    """SQLite WHERE expression for selecting those ROIs that overlap with a specified ROI."""
    return """NOT ((CenterX + Size/2) < :xmin OR
                   (CenterX - Size/2) > :xmax OR
                   (CenterY + Size/2) < :ymin OR
                   (CenterY - Size/2) > :ymax OR
                   (CenterZ + Size/2) < :zmin OR
                   (CenterZ - Size/2) > :zmax)"""


def query_overlapping_rois(db, scan_id, box, cols='*'):
    """Query existing ROIs which overlap with a specified ROI."""
    return db.execute(
        "SELECT {cols} FROM ROIs WHERE ScanId = :scan_id AND {expr}"
        .format(cols=cols, expr=where_rois_overlap()),
        dict(
            scan_id=scan_id,
            xmin=box[0], xmax=box[1],
            ymin=box[2], ymax=box[3],
            zmin=box[4], zmax=box[5]
        )
    )


def bounding_box(center, size):
    """Get extent of ROI given center point and size."""
    r = max(0., .5 * size)
    return (center[0] - r, center[0] + r,
            center[1] - r, center[1] + r,
            center[2] - r, center[2] + r)


def compute_volume(box):
    """Compute volume of ROI."""
    return (box[1] - box[0]) * (box[3] - box[2]) * (box[5] - box[4])


def compute_overlap(box1, vol1, box2, vol2):
    """Compute ratio of overlap between two ROIs."""
    vol_intersection = (max(0., max(box1[1], box2[1]) - min(box1[0], box2[0])) *
                        max(0., max(box1[3], box2[3]) - min(box1[2], box2[2])) *
                        max(0., max(box1[5], box2[5]) - min(box1[4], box2[4])))
    vol_union = vol1 + vol2 - vol_intersection
    return vol_intersection / vol_union


def filter_points(db, scan_id, points, roi_size, max_overlap, max_number_of_points):
    """Filter point set by removing all those with a too large overlap with other ROIs."""
    result = []
    if max_number_of_points == 0:
        return result
    for point in points:
        box1 = bounding_box(center=point, size=roi_size)
        vol1 = compute_volume(box1)
        keep = True
        for roi in query_overlapping_rois(db, scan_id, box1, cols='CenterX, CenterY, CenterZ, Size'):
            box2 = bounding_box(center=(roi[0], roi[1], roi[2]), size=roi[3])
            vol2 = compute_volume(box2)
            overlap = compute_overlap(box1, vol1, box2, vol2)
            if overlap > max_overlap:
                keep = False
                break
        if keep:
            result.append(point)
            if max_number_of_points > 0 and len(result) >= max_number_of_points:
                break
    return result


def insert_roi(db, scan_id, center, size, cmd_id=0, print_sql=False):
    """Insert new ROI into database."""
    sql = "INSERT INTO ROIs (ScanId, CommandId, CenterX, CenterY, CenterZ, Size) VALUES (:scan_id, :cmd_id, :x, :y, :z, :size)"
    par = dict(scan_id=scan_id, cmd_id=cmd_id, x=center[0], y=center[1], z=center[2], size=size)
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
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', help="Session ID", required=True)
    parser.add_argument('--surface', help="Surface mesh file", required=True)
    parser.add_argument('--reference', help="Reference surface mesh file", required=True)
    parser.add_argument('--output', help="Output mesh file with computed surface distances and clusters")
    parser.add_argument('--min-distance', default=1., type=float, help="Minimum distance to reference in mm")
    parser.add_argument('--max-distance', default=float('inf'), type=float, help="Maximum distance to reference in mm")
    parser.add_argument('--min-patch-size', default=10, type=int, help="Minimum number of distant surface patch points")
    parser.add_argument('--min-patch-area', default=0., type=float, help="Minimum area of distant surface patches")
    parser.add_argument('--max-new-rois', default=0, type=int, help="Maximum number of new ROIs to insert")
    parser.add_argument('--max-scan-rois', default=0, type=int, help="Maximum total number of ROIs for each scan")
    parser.add_argument('--max-overlap', default=50, type=int, help="Maximum overlap between scan ROIs in percentage")
    parser.add_argument('--max-overlap-ratio', default=-1., type=float, help="Maximum overlap between scan ROIs as ratio")
    parser.add_argument('--roi-size', default=20., type=float, help="Side length of each scan ROI in mm")
    parser.add_argument('--print-sql', action='store_true', help="Do not insert regions into database, just print SQL statements")
    parser.add_argument('-v', '--verbose', default=0, action='count', help="Verbosity of output messages")
    args = parser.parse_args()
    if args.roi_size < 0:
        raise Exception("Invalid --roi-size argument")
    if args.min_distance < 0. or args.min_distance > args.max_distance:
        raise Exception("Invalid --min-distance and/or --max-distance arguments: [{}, {}]".format(args.min_distance, args.max_distance))
    if args.max_overlap_ratio < 0.:
        args.max_overlap_ratio = args.max_overlap / 100.
    # open database
    con = sqlite3.connect(args.database)
    cur = con.cursor()
    # get foreign keys from database
    scan_id = get_scan_id(cur, args.subject, args.session)
    cmd_id = get_or_insert_command_id(
        cur, name=os.path.basename(__file__), params=options(args, exclude=[
            'database', 'surface', 'reference', 'output',
            'subject', 'session', 'roi_size', 'max_new_rois', 'max_scan_rois',
            'print_sql', 'verbose'
        ]),
        print_sql=args.print_sql
    )
    # select surface points
    points = select_points(args.surface, args.reference,
                           output_name=args.output,
                           min_distance=args.min_distance,
                           max_distance=args.max_distance,
                           min_patch_size=args.min_patch_size,
                           min_patch_area=args.min_patch_area)
    if args.verbose > 0:
        print("Identified {} regions of interest".format(len(points)))
    # remove points close to/overlapping with existing region of interest
    num_scan_rois = get_number_of_rois(cur, scan_id)
    if args.max_new_rois > 0:
        max_new_rois = args.max_new_rois
    else:
        max_new_rois = -1
    if args.max_scan_rois > 0 and args.max_scan_rois - num_scan_rois:
        max_new_rois = max(0, args.max_scan_rois - num_scan_rois)
    points = filter_points(cur, scan_id=scan_id, points=points, roi_size=args.roi_size,
                           max_overlap=args.max_overlap_ratio, max_number_of_points=max_new_rois)
    if args.verbose > 1:
        print("Selected {} regions of interest".format(len(points)))
    # write selected regions of interest to database
    for p in points:
        insert_roi(cur, scan_id=scan_id, center=p, size=args.roi_size, cmd_id=cmd_id, print_sql=args.print_sql)
    if args.verbose > 0:
        print("Inserted {} new regions of interest".format(len(points)))

    cur.close()
    con.commit()
    con.close()
