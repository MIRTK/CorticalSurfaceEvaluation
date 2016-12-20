#!/usr/bin/python

"""Import Robert's vol2mesh surfaces from dHCP structural pipeline v2.3 for comparison."""

import os
import sys
import csv
import argparse
import mirtk


dhcp_derived_data_dir = os.path.join(os.sep, 'vol', 'dhcp-derived-data', 'derived_v2.3', 'ReconstructionsRelease02_derived_v2.3')
dhcp_derived_data_dir = os.path.abspath(dhcp_derived_data_dir)


def get_value_by_case_insensitive_key(row, name):
    """Get column entry from CSV row from csv.DictReader with case insensitive lookup."""
    name = name.lower()
    for col in row.keys():
        if col.lower() == name:
            return row[col]
    return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(prog=os.path.basename(sys.argv[0]), description=__doc__)
    parser.add_argument('prefix', nargs='?', default=os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'meshes', 'v2.3')),
                        help="Output directory for imported surface files")
    parser.add_argument('-sessions', '--sessions', default=[], type=str, nargs='+', required=True,
                        help="List of {SubjectId}-{SessionId} strings or CSV file path")
    parser.add_argument('-derived-data', '--derived-data', default=dhcp_derived_data_dir,
                        help="dHCP derived data source directory")
    args = parser.parse_args()
    if len(args.sessions) == 1 and os.path.isfile(args.sessions[0]):
        csv_name = args.sessions[0]
        args.sessions = []
        with open(csv_name) as f:
            reader = csv.DictReader(f)
            for row in reader:
                subid = get_value_by_case_insensitive_key(row, 'SubjectId')
                sesid = get_value_by_case_insensitive_key(row, 'SessionId')
                if not subid:
                    raise Exception("Missing SubjectId column in CSV file")
                if not sesid:
                    raise Exception("Missing SessionId column in CSV file")
                args.sessions.append('-'.join([subid, sesid]))
    for session in args.sessions:
        subid, sesid = session.split('-')
        src_dir = os.path.join(args.derived_data, 'sub-' + subid, 'ses-' + sesid, 'structural', 'Native', 'surfaces-vtk')
        dst_dir = os.path.join(args.prefix, '{}-{}'.format(subid, sesid))
        if not os.path.isdir(dst_dir):
            os.makedirs(dst_dir)
        dst = os.path.join(dst_dir, 'white-rh.vtp'.format(subid, sesid))
        if not os.path.isfile(dst):
            src = os.path.join(src_dir, 'sub-{}_ses-{}_T2MS_T2MS_Co3DOutSVRMot.R.white.native.surf.vtk'.format(subid, sesid))
            mirtk.run('convert-pointset', args=[src, dst])
            print("Imported RH white matter surface of subject {}, session {}".format(subid, sesid))
        dst = os.path.join(dst_dir, 'white-lh.vtp'.format(subid, sesid))
        if not os.path.isfile(dst):
            src = os.path.join(src_dir, 'sub-{}_ses-{}_T2MS_T2MS_Co3DOutSVRMot.L.white.native.surf.vtk'.format(subid, sesid))
            mirtk.run('convert-pointset', args=[src, dst])
            print("Imported LH white matter surface of subject {}, session {}".format(subid, sesid))
