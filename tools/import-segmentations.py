#!/usr/bin/python

"""Import Antonis' Draw-EM segmentations from dHCP structural pipeline v2.4."""

import os
import sys
import csv
import argparse
from shutil import copyfile


dhcp_derived_data_dir = os.path.abspath(os.path.join(os.sep, 'vol', 'dhcp-derived-data', 'structural-pipeline', 'dhcp-v2.4'))


def get_value_by_case_insensitive_key(row, name):
    """Get column entry from CSV row from csv.DictReader with case insensitive lookup."""
    name = name.lower()
    for col in row.keys():
        if col.lower() == name:
            return row[col]
    return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(prog=os.path.basename(sys.argv[0]), description=__doc__)
    parser.add_argument('prefix', nargs='?', default=os.path.normpath(os.path.join(os.path.dirname(__file__), '..')),
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
        src_dir = os.path.join(args.derived_data, 'segmentations')
        dst = os.path.join(args.prefix, 'labels', 'tissues', '{}-{}.nii.gz'.format(subid, sesid))
        if not os.path.isfile(dst):
            src = os.path.join(src_dir, '{}-{}_tissue_labels.nii.gz'.format(subid, sesid))
            par = os.path.dirname(dst)
            if not os.path.isdir(par):
                os.makedirs(par)
            copyfile(src, dst)
            print("Imported tissue segmentation of subject {}, session {}".format(subid, sesid))
        dst = os.path.join(args.prefix, 'labels', 'all', '{}-{}.nii.gz'.format(subid, sesid))
        if not os.path.isfile(dst):
            src = os.path.join(src_dir, '{}-{}_all_labels.nii.gz'.format(subid, sesid))
            par = os.path.dirname(dst)
            if not os.path.isdir(par):
                os.makedirs(par)
            copyfile(src, dst)
            print("Imported structural segmentation of subject {}, session {}".format(subid, sesid))
