#!/usr/bin/python

"""Add CortexMask cell data array to imported vol2mesh surfaces."""

import os
import sys
import re
import csv
import argparse
import mirtk


def get_value_by_case_insensitive_key(row, name):
    """Get column entry from CSV row from csv.DictReader with case insensitive lookup."""
    name = name.lower()
    for col in row.keys():
        if col.lower() == name:
            return row[col]
    return None


if __name__ == '__main__':
    topdir = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
    parser = argparse.ArgumentParser(prog=os.path.basename(sys.argv[0]), description=__doc__)
    parser.add_argument('-sessions', '--sessions', default=[], type=str, nargs='+', required=True,
                        help="List of {SubjectId}-{SessionId} strings or CSV file path")
    parser.add_argument('-labels', '--labels',
                        default=os.path.join(topdir, 'labels', 'tissues', '{SubjectId}-{SessionId}.nii.gz'),
                        help="File path template string for tissue segmentations")
    parser.add_argument('-surface', '--surface', required=True,
                        help="File path template string for input/output surface mesh")
    parser.add_argument('-hemisphere', '--hemisphere', default=('rh', 'lh'), type=str, nargs='+',
                        help="Substitution values for {Hemisphere} placeholder in -surface file path")
    parser.add_argument('-temp', '--temp', default=os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'temp')),
                        help="Directory for temporary files")
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

    hemis = args.hemisphere
    if re.search("\{[hH](emi(sphere)?)?\}", args.surface) is None:
        if len(hemis) > 0:
            raise Exception("Missing {Hemisphere} placeholder in surface file path template string")
        else:
            hemis = ('')
    elif len(hemis) == 0:
        raise Exception("No -hemisphere(s) specified, but -surface file path template contains {Hemisphere} placeholder")

    tmpdir = os.path.abspath(args.temp)
    if not os.path.isdir(tmpdir):
        os.makedirs(tmpdir)

    for session in args.sessions:
        subid, sesid = session.split('-')
        info = {
            'sub': subid,
            'subject': subid,
            'subjectid': subid,
            'subjectId': subid,
            'SubjectId': subid,
            'SubjectID': subid,
            'ses': sesid,
            'session': sesid,
            'sessionid': sesid,
            'sessionId': sesid,
            'SessionId': sesid,
            'SessionID': sesid,
        }
        labels = args.labels.format(**info)
        mask = os.path.join(tmpdir, '{SubjectId}-{SessionId}-cortex-mask.nii.gz'.format(**info))
        mirtk.run(
            'calculate-element-wise',
            args=[labels],
            opts=[('label', 2), ('set', 1), ('pad', 0), ('out', mask, 'binary')]
        )
        for hemi in hemis:
            info['h'] = hemi
            info['H'] = hemi
            info['hemi'] = hemi
            info['Hemi'] = hemi
            info['hemisphere'] = hemi
            info['Hemisphere'] = hemi
            mesh = args.surface.format(**info)
            mirtk.run(
                'project-onto-surface',
                args=[mesh, mesh],
                opts={
                    'labels': mask,
                    'dilation-radius': .5,
                    'fill': True,
                    'max-hole-size': 1000,
                    'point-data': False,
                    'cell-data': True,
                    'name': 'CortexMask'
                }
            )
            mirtk.run(
                'calculate-element-wise',
                args=[mesh],
                opts=[('cell-data', 'CortexMask'), ('out', mesh, 'uchar')]
            )
        os.remove(mask)
