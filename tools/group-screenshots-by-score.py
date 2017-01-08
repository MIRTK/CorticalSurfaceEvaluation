#!/usr/bin/python

"""Create PDF report with evaluation screenshots grouped by their respective score."""


import os
import argparse
import sqlite3

from matplotlib import pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.image import imread


def get_scores(db):
    cur = db.cursor()
    try:
        return [row[0] for row in cur.execute("SELECT DISTINCT(Score) FROM EvaluationScores ORDER BY Score ASC").fetchall()]
    finally:
        cur.close()


def get_label(db, score):
    cur = db.cursor()
    try:
        return cur.execute("SELECT Label FROM Scores WHERE Value = {}".format(score)).fetchone()[0]
    finally:
        cur.close()


def get_overlay_id(db, name):
    cur = db.cursor()
    try:
        return cur.execute("SELECT OverlayId FROM Overlays WHERE Name = :name", {'name': name}).fetchone()[0]
    finally:
        cur.close()


def evaluation_screenshots(db, score, overlay=None, limit=0):
    cur = db.cursor()
    try:
        sql = """
            SELECT FileName FROM EvaluationScreenshots AS A
            LEFT JOIN EvaluationScores AS B
            ON A.ScreenshotId = B.ScreenshotId
            WHERE Score = {}
        """.format(score)
        if overlay:
            if isinstance(overlay, int):
                sql += "AND OverlayId = {}".format(overlay)
            else:
                sql += "AND OverlayId IN {}".format(tuple(overlay))
        sql += " GROUP BY ROI_Id "
        if limit > 0:
            sql += " LIMIT {}".format(limit)
        return [row[0] for row in cur.execute(sql).fetchall()]
    finally:
        cur.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help="Evaluation SQLite database file")
    parser.add_argument('output', help="Output PDF report")
    parser.add_argument('--overlay', default=[3], nargs='+', help="Overlay ID or name")
    parser.add_argument('--limit', default=0, type=int, help="Maximum no. of screenshots per group/score")
    args = parser.parse_args()

    screenshots = {}
    labels = {}

    db = sqlite3.connect(args.database)
    base = os.path.dirname(args.database)

    try:
        overlays = []
        for overlay in args.overlay:
            try:
                o = int(overlay)
            except ValueError:
                o = get_overlay_id(db, overlay)
                if not o:
                    raise Exception("Unknown --overlay: {}".format(overlay))
            overlays.append(o)
        scores = get_scores(db)
        for score in scores:
            screenshots[score] = evaluation_screenshots(db, score=score, overlay=overlays)
            labels[score] = label = get_label(db, score)
    finally:
        db.close()

    with PdfPages(args.output) as pdf:
        for score in scores:
            fnames = screenshots[score]
            if args.limit > 0 and len(fnames) > args.limit:
                fnames = fnames[0:args.limit]
            npages = (len(fnames) + 11) / 12
            for page in range(npages):
                first = page * 12
                last = min(first + 12, len(fnames))
                if first >= last:
                    break
                title = labels[score]
                if npages > 1:
                    title += ' ({}/{})'.format(page + 1, npages)
                # title = '{}: Screenshots {} to {} out of {}'.format(labels[score], first + 1, last, len(fnames))
                print(title)
                fig, axes = plt.subplots(4, 3, figsize=(8.25, 11))
                plt.subplots_adjust(wspace=.02, hspace=.02)
                fig.suptitle(title, fontsize=12, fontweight='bold')
                for i in range(12):
                    subplt = axes[i / 3][i % 3]
                    if i < last - first:
                        subplt.imshow(imread(os.path.join(base, fnames[first + i])))
                    subplt.axis('off')
                pdf.savefig(papertype='a4', dpi=120)
                plt.close()
        d = pdf.infodict()
        d['Title'] = 'Evaluation screenshots grouped by score'
