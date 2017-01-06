#!/opt/anaconda/bin/python

"""Plot evaluation results given SQLite database."""

import os
import argparse
import sqlite3
import numpy as np
from matplotlib import pyplot as plt, ticker


max_score = 4


def evaluation_scores(db, overlay, rater=None):
    c = db.cursor()
    try:
        query = """
            SELECT Score FROM EvaluationScreenshots AS A
            INNER JOIN EvaluationScores AS B
            ON A.ScreenshotId = B.ScreenshotId AND Score > 0 AND OverlayId = {}
        """.format(overlay)
        if rater:
            query += " AND RaterId = {}".format(rater)
        c.execute(query)
        arr = np.fromiter(c.fetchall(), dtype=[('scores', 'u1')])['scores']
    finally:
        c.close()
    scores, counts = np.unique(arr, return_counts=True)
    if max(scores) > max_score:
        raise Exception("Expected scores in the interval [0, {}]".format(max_score))
    result = np.zeros(max_score, dtype=np.uint32)
    for score, count in zip(scores, counts):
        result[score - 1] = count
    return result


def comparison_choices(db, overlay1, overlay2, rater=None):
    if overlay1 > overlay2:
        id1, id2 = overlay2, overlay1
    else:
        id1, id2 = overlay1, overlay2
    c = db.cursor()
    try:
        query = """
            SELECT BestOverlayId FROM ComparisonScreenshots AS A
            INNER JOIN ComparisonChoices AS B
            ON A.ScreenshotId = B.ScreenshotId
            AND OverlayId1 = {id1}
            AND OverlayId2 = {id2}
            AND ROI_Id NOT IN (
              SELECT ROI_Id FROM Screenshots AS A
              INNER JOIN EvaluationScores AS B
              ON A.ScreenshotId = B.ScreenshotId AND Score = 0
              GROUP BY ROI_Id
            )
        """.format(id1=id1, id2=id2)
        if rater:
            query += " AND RaterId = {}".format(rater)
        c.execute(query)
        arr = np.fromiter(c.fetchall(), dtype=[('overlay', 'u1')])['overlay']
    finally:
        c.close()
    ids, counts = np.unique(arr, return_counts=True)
    if len(ids) == 0:
        return np.zeros(1)
    elif len(ids) == 2:
        ids = [0] + ids
        np.insert(ids, obj=0, values=0)
        np.insert(counts, obj=0, values=0)
    elif ids[0] != 0:
        raise Exception("Expected first overlay ID to be 0, i.e., choice 'Neither'")
    if ids[1] == overlay2:
        ids[1], ids[2] = ids[2], ids[1]
        counts[1], counts[2] = counts[2], counts[1]
    return counts


def render(fname=None, dpi=1200):
    if fname and not fname.lower() == 'show':
        plt.savefig(fname, dpi=dpi)
    else:
        plt.show()


def plot_evaluation_scores(db, rater=0, fname=None, dpi=1200):
    fontname = 'Arial'

    fig, ax = plt.subplots(figsize=(10, 4), facecolor='white')

    bottom = np.arange(0, max_score, dtype=np.float)[::-1]
    height = .4

    count = evaluation_scores(db, overlay=4, rater=rater)
    width = 100 * (count.astype(np.float) / float(count.sum()))
    max_width = width.max()
    rects1 = ax.barh(bottom + height, width=width, height=height, facecolor='#e85f5f', edgecolor='white')

    count = evaluation_scores(db, overlay=3)
    width = 100 * (count.astype(np.float) / float(count.sum()))
    max_width = max(max_width, width.max())
    rects2 = ax.barh(bottom, width=width, height=height, facecolor='#4682b4', edgecolor='white')

    ax.set_xlabel('Percentage of samples with assigned score', fontname=fontname, size=16, labelpad=10)
    ax.xaxis.set_ticks(np.arange(0, max_width + 6, 5))
    ax.xaxis.set_major_formatter(ticker.FormatStrFormatter('%0.0f%%'))
    fig.subplots_adjust(bottom=.2)

    ax.set_ylim(-height / 2, max_score)
    ax.set_yticks(bottom + height)
    ax.set_yticklabels(('Poor', 'Fair', 'Good', 'Excellent'), fontname=fontname, size=14)
    ax.yaxis.set_tick_params(pad=6)

    ax.legend((rects1[0], rects2[0]), ('vol2mesh', 'proposed'), loc='upper right', fontsize=12)
    render(fname=fname, dpi=dpi)


def plot_comparison_choices(db, overlays,
                            labels=('reference', 'proposed'),
                            colors=('#e85f5f', '#4682b4'),
                            rater=0, fname=None, dpi=1200):
    fig = plt.figure(figsize=(6.5, 5), facecolor='white')
    axes = fig.gca()
    wedges, labels, texts = axes.pie(comparison_choices(db, overlay1=overlays[0], overlay2=overlays[1], rater=rater),
                                     labels=('neither', labels[0], labels[1]),
                                     colors=('lightgrey', colors[0], colors[1]),
                                     autopct='%1.0f%%', startangle=180, counterclock=False)
    for wedge in wedges:
        wedge.set_edgecolor('white')
    for label in labels:
        label.set_fontname('Arial')
        label.set_fontsize(16)
    for text in texts:
        text.set_fontsize(14)
        text.set_fontname('Arial')
        text.set_fontweight('medium')
    axes.axis('equal')
    render(fname=fname, dpi=dpi)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',
                        help="SQLite database with evaluation results")
    parser.add_argument('--dpi', default=1200, type=int,
                        help="Dots per inch for output figures")
    parser.add_argument('--scores', nargs='?', const='show',
                        help="Plot evaluation scores of white matter surfaces")
    parser.add_argument('--compare-initial', nargs='?', const='show',
                        help="Plot comparison choices between initial and final white matter surface")
    parser.add_argument('--compare-vol2mesh', nargs='?', const='show',
                        help="Plot comparison choices between vol2mesh and white matter surface")
    parser.add_argument('--rater', default=0, type=int,
                        help="ID of rater whose results should be plotted, zero for any rater")
    args = parser.parse_args()
    args.database = os.path.abspath(args.database)

    db = sqlite3.connect(args.database)
    try:
        if (not args.scores and
                not args.compare_initial and
                not args.compare_vol2mesh):
            if (evaluation_scores(db, overlay=3, rater=args.rater).sum() > 0 and
                    evaluation_scores(db, overlay=4, rater=args.rater).sum() > 0):
                args.scores = 'show'
            if comparison_choices(db, overlay1=2, overlay2=3, rater=args.rater).sum() > 0:
                args.compare_initial = 'show'
            if comparison_choices(db, overlay1=3, overlay2=4, rater=args.rater).sum() > 0:
                args.plot_comparison_with_vol2mesh = 'show'
        if args.scores:
            plot_evaluation_scores(db, fname=args.scores, rater=args.rater, dpi=args.dpi)
        if args.compare_initial:
            plot_comparison_choices(db, fname=args.compare_initial, rater=args.rater,
                                    overlays=(2, 3), labels=('initial', 'proposed'), dpi=args.dpi)
        if args.compare_vol2mesh:
            plot_comparison_choices(db, fname=args.compare_vol2mesh, rater=args.rater,
                                    overlays=(4, 3), labels=('vol2mesh', 'proposed'), dpi=args.dpi)
    finally:
        db.close()
