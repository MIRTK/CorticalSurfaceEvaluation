#!/usr/bin/python

"""Add rater to the SQLite database"""

import sqlite3
import argparse
import random
import string


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--email', help='Email address', required=True)
parser.add_argument('--password', '--pwd', default="auto", help="Password")
parser.add_argument('--first-name', '--first', help="First name", required=True)
parser.add_argument('--last-name', '--last', help="Last name", required=True)
parser.add_argument('--affiliation', '--aff', help="Affiliation")
parser.add_argument('database', help="SQLite database file")
args = parser.parse_args()

if args.password == 'auto':
    args.password = ''.join(random.choice(string.ascii_lowercase + string.digits) for i in range(8))
    print(args.password)

con = sqlite3.connect(args.database)
cur = con.cursor()

cur.execute('''INSERT INTO Raters (Email,Password,FirstName,LastName,Affiliation)
            VALUES ('{email}','{password}','{first_name}','{last_name}','{affiliation}')'''.format(
            email=args.email, password=args.password,
            first_name=args.first_name, last_name=args.last_name,
            affiliation=args.affiliation))

con.commit()
cur.close()
con.close()
