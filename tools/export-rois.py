#!/usr/bin/python

"""Save selected ROIs as vtkPolyData for visualization with ParaView."""

import argparse
import sqlite3

from vtk import vtkPolyData, vtkPoints, vtkXMLPolyDataWriter


def get_scans(db, subject_id, session_id=0):
    """Get ScanId(s) corresponding to given pair of subject and session IDs."""
    if session_id > 0:
        res = db.execute("SELECT ScanId FROM Scans WHERE SubjectId = :subject_id AND SessionId = :session_id",
                         dict(subject_id=subject_id, session_id=session_id))
    else:
        res = db.execute("SELECT ScanId FROM Scans WHERE SubjectId = :subject_id",
                         dict(subject_id=subject_id))
    res = res.fetchall()
    if res and len(res) > 0:
        return res
    else:
        raise Exception("ScanId not found for SubjectId={} and SessionId={}".format(subject_id, session_id))


def get_rois(db, scan_id):
    """Get ROIs selected from given scan."""
    return db.execute("SELECT ROI_Id, CenterX, CenterY, CenterZ FROM ROIs WHERE ScanId = :scan_id", {'scan_id': scan_id}).fetchall()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('output', help="Output point set file")
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', default=0, help="Session ID")
    args = parser.parse_args()
    points = vtkPoints()
    db = sqlite3.connect(args.database)
    try:
        for scan in get_scans(db, args.subject, args.session):
            print("Scan ID = {}".format(scan[0]))
            for roi in get_rois(db, scan[0]):
                points.InsertNextPoint(roi[1], roi[2], roi[3])
    finally:
        db.close()
    pset = vtkPolyData()
    pset.SetPoints(points)
    writer = vtkXMLPolyDataWriter()
    writer.SetInputData(pset)
    writer.SetFileName(args.output)
    writer.Write()
