#!/usr/bin/python

"""Construct evaluation sets from screenshots."""

import os
import sys
import sqlite3
import argparse
import traceback


def get_scan_id(db, subject_id, session_id):
    """Get ScanId corresponding to given pair of subject and session IDs."""
    res = db.execute("SELECT ScanId FROM Scans WHERE SubjectId = :subject_id AND SessionId = :session_id",
                     dict(subject_id=subject_id, session_id=session_id)).fetchone()
    if not res:
        raise Exception("ScanId not found for SubjectId={} and SessionId={}".format(subject_id, session_id))
    return res[0]


def get_rois(db, scan_id):
    """Get IDs of ROIs of a given MRI scan."""
    res = db.execute("SELECT ROI_Id FROM ROIs WHERE ScanId = :scan_id", dict(scan_id=scan_id))
    return [row[0] for row in res]


def get_overlay(db, name):
    """Get OverlayId corresponding to overlay of given name."""
    res = db.execute("SELECT OverlayId FROM Overlays WHERE Name = :name", dict(name=name)).fetchone()
    if not res:
        raise Exception("Unknown overlay: " + name)
    return res[0]


def get_orthogonal_screenshots(db, roi, overlays=[]):
    """Get IDs of orthogonal screenshots showing only the specified overlays or none at all."""
    if overlays:
        res = db.execute("""
            SELECT ScreenshotId FROM Screenshots AS T1
            WHERE ROI_Id = :roi AND ViewId IN ('A', 'C', 'S') AND
            (SELECT COUNT(DISTINCT OverlayId) FROM ScreenshotOverlays AS T2 WHERE T2.ScreenshotId = T1.ScreenshotId) = {} AND
            (SELECT OverlayId FROM ScreenshotOverlays AS T2 WHERE T2.ScreenshotId = T1.ScreenshotId) IN ({})
        """.format(len(overlays), ','.join([str(o) for o in overlays])), dict(roi=roi))
    else:
        res = db.execute("""
            SELECT ScreenshotId FROM Screenshots AS T1
            WHERE ROI_Id = :roi AND ViewId IN ('A', 'C', 'S') AND
            (SELECT COUNT(OverlayId) FROM ScreenshotOverlays AS T2 WHERE T2.ScreenshotId = T1.ScreenshotId) = 0
        """.format(','.join(overlays)), dict(roi=roi))
    return [row[0] for row in res]


def get_evaluation_set(db, screenshots):
    """Get evaluation set consisting of the specified screenshots."""
    res = db.execute("""
        SELECT DISTINCT(EvaluationSetId) FROM EvaluationSets AS A
        WHERE A.EvaluationSetId NOT IN (
          SELECT EvaluationSetId FROM EvaluationSets AS B
          WHERE B.ScreenshotId NOT IN ({screenshot_ids})
        ) AND (
            SELECT COUNT(DISTINCT ScreenshotId) FROM EvaluationSets AS C
            WHERE C.EvaluationSetId = A.EvaluationSetId
        ) = {num}
    """.format(screenshot_ids=','.join([str(s) for s in screenshots]), num=len(screenshots)))
    row = res.fetchone()
    if row:
        return row[0]
    return None


def next_evaluation_set_id(db):
    """Get next unused evaluation set ID."""
    max_id = 0
    for table in ('EvaluationSets', 'InitialSurfaceScores', 'WhiteMatterSurfaceScores', 'WhiteMatterSurfaceComparison'):
        res = db.execute("SELECT MAX(EvaluationSetId) FROM " + table).fetchone()
        if res and res[0] and res[0] > max_id:
            max_id = res[0]
    return max_id + 1


def new_evaluation_set(db, screenshots):
    """Insert new evaluation set."""
    set_id = next_evaluation_set_id(db)
    for screenshot in screenshots:
        db.execute("""
            INSERT INTO EvaluationSets (EvaluationSetId, ScreenshotId)
            VALUES (:id, :screenshot)
        """, {'id': set_id, 'screenshot': screenshot})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', help="Session ID", required=True)
    args = parser.parse_args()

    args.database = os.path.abspath(args.database)
    con = sqlite3.connect(args.database)

    try:
        cur = con.cursor()
    except:
        con.close()
        exc_type, exc_value, exc_traceback = sys.exc_info()
        traceback.print_exception(exc_type, exc_value, exc_traceback)

    try:
        scan_id = get_scan_id(cur, args.subject, args.session)
        initial_mesh_id = get_overlay(cur, "Initial surface")
        white_mesh_id = get_overlay(cur, "White matter surface")
    except:
        cur.close()
        con.close()
        exc_type, exc_value, exc_traceback = sys.exc_info()
        traceback.print_exception(exc_type, exc_value, exc_traceback)

    try:
        for roi_id in get_rois(cur, scan_id):
            for overlays in ([initial_mesh_id], [white_mesh_id], [initial_mesh_id, white_mesh_id]):
                screenshots = get_orthogonal_screenshots(cur, roi_id, overlays=overlays)
                set_id = get_evaluation_set(cur, screenshots)
                if not set_id:
                    new_evaluation_set(cur, screenshots)
                con.commit()
    except:
        con.rollback()
        exc_type, exc_value, exc_traceback = sys.exc_info()
        traceback.print_exception(exc_type, exc_value, exc_traceback)
    finally:
        cur.close()
        con.close()
