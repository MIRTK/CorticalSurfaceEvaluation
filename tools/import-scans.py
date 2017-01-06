#!/usr/bin/python

"""Import pairs of subject and session IDs into the SQLite database"""

import csv
import sqlite3
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('csv_file', help="CSV table with 'SubjectId,SessionId' columns")
parser.add_argument('database', help="SQLite database file")
args = parser.parse_args()

con = sqlite3.connect(args.database)
cur = con.cursor()

with open(args.csv_file) as f:
    reader = csv.DictReader(f)
    for row in reader:
        if 'SubjectId' not in row:
            if 'SubjectID' in row:
                row['SubjectId'] = row['SubjectID']
            else:
                raise Exception('Missing SubjectI[dD] column')
        if 'SessionId' not in row:
            if 'SessionID' in row:
                row['SessionId'] = row['SessionID']
            else:
                row['SessionId'] = 0
        ans = cur.execute('''SELECT EXISTS(SELECT 1 FROM Scans
                             WHERE SubjectId='{SubjectId}' AND
                                   SessionId='{SessionId}' LIMIT 1)'''.format(**row))
        if ans.fetchone()[0] == 0:
            cur.execute('''INSERT INTO Scans (SubjectId,SessionId)
                           VALUES ('{SubjectId}','{SessionId}')'''.format(**row))
        con.commit()

cur.close()
con.close()
