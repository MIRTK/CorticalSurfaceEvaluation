#!/usr/bin/python

"""Join right and left vol2mesh surfaces into single file."""

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
    parser.add_argument('-input', '--input', required=True,
                        help="File path template string for input surface meshes")
    parser.add_argument('-output', '--output', required=True,
                        help="File path template string for output surface meshes")
    parser.add_argument('-hemisphere', '--hemisphere', default=('rh', 'lh'), type=str, nargs='+',
                        help="Substitution values for {Hemisphere} placeholder in -input file path")
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

    if re.search("\{[hH](emi(sphere)?)?\}", args.input) is None:
        raise Exception("Missing {Hemisphere} placeholder in -input file path")
    elif len(args.hemisphere) == 0:
        raise Exception("No -hemisphere substitution values specified")

    if re.search("\{[hH](emi(sphere)?)?\}", args.output) is not None:
        raise Exception("{Hemisphere} placeholder not allowed in -output file path")

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
        paths = []
        for hemi in args.hemisphere:
            info['h'] = hemi
            info['H'] = hemi
            info['hemi'] = hemi
            info['Hemi'] = hemi
            info['hemisphere'] = hemi
            info['Hemisphere'] = hemi
            paths.append(args.input.format(**info))
        paths.append(args.output.format(**info))
        mirtk.run('convert-pointset', args=paths)
