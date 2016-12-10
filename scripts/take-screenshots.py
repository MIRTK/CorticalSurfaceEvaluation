#!/usr/bin/python

"""Take screenshots of different views rendered from a single selected ROI.

FIXME: This is run in a separate Python process for each ROI only because there
       is some memory leak in the code calling VTK to render the screenshots.
"""

import os
import sys
import sqlite3
import argparse
import random
import string
import subprocess

from vtk import (vtkImageData, vtkPolyData, vtkMatrix4x4, vtkMatrixToLinearTransform,
                 vtkNIFTIImageReader, vtkXMLPolyDataReader)

from mirtk.rendering.screenshots import take_orthogonal_screenshots, range_to_level_window


def rgb(r, g, b):
    """Convert RGB byte value in [0, 255] to float in [0, 1]."""
    return (float(r) / 255., float(g) / 255., float(b) / 255.)


# Color should be neutral and not relate to colors for scoring buttons.
single_overlay_color = rgb(255, 245, 61)

# Colors must be distinct enough so that any pair of two colors can be
# selected randomly and the two overlays can still be easily distinguished.
#
# This list is randomly shuffled in the for loop of the main function in place
# and the first two colors are used for the two different contours.
#
# By default, only the first two colors are used such that the buttons of
# the two choices don't need to change color all the time. Only the
# assignment of each of the two colors to the two contours is random.
multi_overlay_colors = [
    rgb(0, 194, 120),   # dark green (+orange)
    rgb(255, 193, 61),  # orange (+dark green)
    rgb(61, 216, 255),  # light blue
    rgb(39, 0, 194),    # dark blue
    rgb(135, 255, 61),  # light green
    rgb(255, 61, 242),  # pink
    rgb(247, 32, 57)    # red
]


# http://ideone.com/xykV7R
class FormatPlaceholder:
    def __init__(self, key):
        self.key = key

    def __format__(self, spec):
        result = self.key
        if spec:
            result += ":" + spec
        return "{" + result + "}"


class FormatDict(dict):
    def __missing__(self, key):
        return FormatPlaceholder(key)


def partial_format(format_string, **kwargs):
    """Partially format string."""
    formatter = string.Formatter()
    mapping = FormatDict(**kwargs)
    return formatter.vformat(format_string, (), mapping)


def get_scan_id(db, subject_id, session_id):
    """Get ScanId corresponding to given pair of subject and session IDs."""
    res = db.execute("SELECT ScanId FROM Scans WHERE SubjectId = :subject_id AND SessionId = :session_id",
                     dict(subject_id=subject_id, session_id=session_id)).fetchone()
    if res:
        return res[0]
    else:
        raise Exception("ScanId not found for SubjectId={} and SessionId={}".format(subject_id, session_id))


def get_overlay_id(db, name):
    """Get OverlayId corresponding to overlay of given name."""
    res = db.execute("SELECT OverlayId FROM Overlays WHERE Name = '{}'".format(name)).fetchone()
    if not res:
        raise Exception("Unknown overlay: " + name)
    return res[0]


def get_overlay_name(db, overlay_id):
    """Get Name corresponding to overlay with given ID."""
    res = db.execute("SELECT Name FROM Overlays WHERE OverlayId = {}".format(overlay_id)).fetchone()
    if not res:
        raise Exception("Invalid overlay ID: " + overlay_id)
    return res[0]


def color_to_byte_value(x):
    """Convert decimal color value in [0, 1] to integer in [0, 255]."""
    return max(0, min(int(round(255. * float(x))), 255))


def color_code(color):
    r = color_to_byte_value(color[0])
    g = color_to_byte_value(color[1])
    b = color_to_byte_value(color[2])
    return "#{0:02x}{1:02x}{2:02x}".format(r, g, b)


def read_image(fname):
    """Read image from file."""
    reader = vtkNIFTIImageReader()
    reader.SetFileName(fname)
    reader.UpdateWholeExtent()
    output = vtkImageData()
    output.DeepCopy(reader.GetOutput())
    qform = vtkMatrix4x4()
    qform.DeepCopy(reader.GetQFormMatrix())
    return (output, qform)


def read_surface(fname):
    """Read surface mesh from file."""
    reader = vtkXMLPolyDataReader()
    reader.SetFileName(fname)
    reader.UpdateWholeExtent()
    output = vtkPolyData()
    output.DeepCopy(reader.GetOutput())
    return output


def compute_offsets(length, subdiv):
    """Compute slice offsets from ROI center."""
    offsets = [0.]
    if subdiv > 0:
        offsets = []
        delta = (length / 2.) / (subdiv + 1)
        offset = -subdiv * delta
        for i in xrange(2 * subdiv + 1):
            offsets.append(offset)
            offset += delta
    return offsets


# def query_screenshots(db, roi_id=None, view_id=None, center=None, overlays=[], colors=[], cols="*"):
#     """Query screenshots matching only the given criteria."""
#     query = "SELECT {} FROM Screenshots AS S".format(', '.join(["S." + col for col in cols]))
#     if len(overlays) > 0:
#         query += "INNER JOIN ScreenshotOverlays AS O ON O.ScreenshotId = S.ScreenshotId"
#     else:
#         query += "LEFT JOIN ScreenshotOverlays AS O ON O.ScreenshotId = S.ScreenshotId"
#     if roi_id:
#         query += " AND ROI_Id = {}".format(roi_id)
#     if view_id:
#         query += " AND ViewId = {}".format(view_id)
#     if center:
#         query += " AND CenterI = {} AND CenterJ = {} AND CenterK = {}".format(*center)
#     if len(overlays) > 0:
#         query += " AND "
#         if len(overlays) > 1:
#             query += "(("
#         for i in xrange(len(overlays)):
#             if i < len(colors):
#                 color = color_code(colors[i])
#             else:
#                 color = None
#             if i > 0:
#                 query += ") OR ("
#             query += "OverlayId = {}".format(overlays[i])
#             if color:
#                 query += " AND Color = " + color
#             else:
#                 query += " AND Color IS NULL"
#         if len(overlays) > 1:
#             query += "))"
#     query += "GROUP BY S.ScreenshotId HAVING COUNT(OverlayId) = {}".format(len(overlays))
#     return db.execute(query).fetchall()


def insert_screenshots(db, roi_id, base, screenshots, overlays=[], colors=[], verbose=0):
    """Insert screenshots into database."""
    view_ids = ('S', 'C', 'A')  # zdir=(0: yz-slice, 1: xz-slice, 2: xy-slice)
    screenshot_ids = []
    for screenshot in screenshots:
        params = {
            'roi': roi_id,
            'i': screenshot[2][0],
            'j': screenshot[2][1],
            'k': screenshot[2][2],
            'view': view_ids[screenshot[1]]
        }
        path = screenshot[0]
        if base:
            path = os.path.relpath(path, base)
        res = db.execute("SELECT ScreenshotId FROM Screenshots WHERE FileName = '{}'".format(path)).fetchone()
        if res:
            screenshot_id = res[0]
        else:
            params['path'] = path
            if verbose > 0:
                print("Insert screenshot: " + path)
            cur = db.cursor()
            try:
                cur.execute(
                    """INSERT INTO Screenshots (FileName, ROI_Id, CenterI, CenterJ, CenterK, ViewId)
                       VALUES (:path, :roi, :i, :j, :k, :view)
                    """, params)
                screenshot_id = cur.lastrowid
                for j in xrange(len(overlays)):
                    cur.execute("""
                        INSERT INTO ScreenshotOverlays (ScreenshotId, OverlayId, Color)
                        VALUES (:screenshot, :overlay, :color)
                        """, {'screenshot': screenshot_id, 'overlay': overlays[j], 'color': color_code(colors[j])})
            finally:
                cur.close()
            db.commit()
        screenshot_ids.append(screenshot_id)
    return screenshot_ids


def take_screenshots_of_single_roi(args):
    # arguments
    args.database = os.path.abspath(args.database)
    base_dir = os.path.dirname(args.database)

    level_window = None  # i.e., default
    if args.range:
        level_window = range_to_level_window(*args.range)

    # read intensity image
    image, qform = read_image(os.path.abspath(args.image))
    image2world = vtkMatrixToLinearTransform()
    image2world.SetInput(qform)
    image2world.Update()
    world2image = image2world.GetLinearInverse()

    # with database connection open...
    db = sqlite3.connect(args.database)
    try:
        # pre-configure output path
        if args.scan > 0:
            scan_id = args.scan
        else:
            scan_id = get_scan_id(db, args.subject, args.session)
        if args.prefix:
            prefix = os.path.abspath(args.prefix)
            prefix = partial_format(prefix, subject=args.subject, session=args.session, scan=scan_id, roi=args.roi)
        else:
            prefix = os.path.join(base_dir, '-'.join([args.subject, args.session]), 'screenshots', 'roi-slices')
        path_format = args.path_format
        if not path_format:
            path_format = os.path.join('{prefix}', 'roi-{roi:06d}-{n:02d}_idx-{i:03d}-{j:03d}-{k:03d}_{suffix}')
        path_format = partial_format(path_format, subject=args.subject, session=args.session, scan=scan_id, roi=args.roi)

        # get ROI parameters
        row = db.execute("SELECT CenterX, CenterY, CenterZ, Span FROM ROIs WHERE ROI_Id = {}".format(args.roi)).fetchone()
        center = [0, 0, 0]
        span = args.zoom * row[3]
        world2image.TransformPoint((row[0], row[1], row[2]), center)
        offsets = compute_offsets(span, args.subdiv)

        # collect information about overlays and read input files
        overlays = []
        cur = db.cursor()
        try:
            for overlay in args.overlay:
                try:
                    overlay_id = int(overlay[0])
                    overlay_name = get_overlay_name(cur, overlay_id)
                except ValueError:
                    overlay_name = overlay[0]
                    overlay_id = get_overlay_id(cur, overlay_name)
                overlays.append((
                    overlay_id,
                    overlay_name,
                    read_surface(os.path.abspath(overlay[1]))
                ))
        finally:
            cur.close()

        # choose colors
        if len(overlays) == 1:
            colors = [single_overlay_color]
        elif args.use_all_colors:
            colors = list(multi_overlay_colors)
        else:
            colors = multi_overlay_colors[0:len(overlays)]
        if (len(overlays) > len(colors)):
            raise Exception("Not enough different colors defined to render {} overlays".format(len(overlays)))
        if args.shuffle_colors and len(colors) > 1:
            random.shuffle(colors)

        # take screenshots of orthogonal slices of ROI volume
        if args.verbose > 0:
            print("Take screenshots of orthogonal slices of ROI volume {}".format(args.roi))
        screenshots = []
        try:
            screenshots = take_orthogonal_screenshots(
                image, level_window=level_window, qform=qform,
                prefix=prefix, suffix=args.suffix, path_format=path_format,
                center=center, length=span, offsets=offsets,
                polydata=[x[2] for x in overlays], colors=colors, line_width=args.line_width,
                size=args.size, overwrite=False)
            insert_screenshots(db, roi_id=args.roi, base=base_dir, screenshots=screenshots,
                               overlays=[x[0] for x in overlays], colors=colors, verbose=(args.verbose - 1))
        except BaseException as e:
            for screenshot in screenshots:
                path = screenshot[0]
                if os.path.isfile(path):
                    os.remove(path)
            raise(e)
        if args.verbose > 0:
            print("Saved screenshots of orthogonal slices of ROI volume {}".format(args.roi))
    finally:
        db.close()


def call_this_script_for_each_roi(args):
    db = sqlite3.connect(args.database)
    try:
        scan_id = get_scan_id(db, args.subject, args.session)
        rows = db.execute("SELECT ROI_Id FROM ROIs WHERE ScanId = {}".format(scan_id)).fetchall()
    finally:
        db.close()
    for row in rows:
        argv = [
            os.path.abspath(__file__),
            args.database,
            '--roi', row[0],
            '--scan', scan_id,
            '--subject', args.subject,
            '--session', args.session,
            '--image', args.image
        ]
        for overlay in args.overlay:
            argv.append('--overlay')
            argv.extend(overlay)
        if args.path_format:
            argv.extend(['--path-format', args.path_format])
        if args.prefix:
            argv.extend(['--prefix', args.prefix])
        if args.suffix:
            argv.append('--suffix')
            argv.extend(args.suffix)
        if args.zoom:
            argv.extend(['--zoom', args.zoom])
        if args.range:
            argv.append('--range')
            argv.extend(args.range)
        if args.subdiv:
            argv.extend(['--subdiv', args.subdiv])
        if args.size:
            argv.append('--size')
            argv.extend(args.size)
        if args.shuffle_colors:
            argv.append('--shuffle-colors')
        if args.use_all_colors:
            argv.append('--use-all-colors')
        if args.line_width:
            argv.extend(['--line-width', args.line_width])
        for i in range(args.verbose):
            argv.append('-v')
        argv = [str(arg) for arg in argv]
        if args.verbose > 0:
            sys.stdout.write('\n')
        if args.verbose > 2:
            print(' '.join(['"' + arg + '"' if ' ' in arg else arg for arg in argv]))
        subprocess.check_call(argv)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',
                        help="SQLite database file")
    parser.add_argument('--scan', type=int, default=0,
                        help="ID of subject/session scan")
    parser.add_argument('--roi', type=int, default=0,
                        help="ID of region of interest")
    parser.add_argument('--subject',
                        help="Subject ID", required=True)
    parser.add_argument('--session',
                        help="Session ID", required=True)
    parser.add_argument('--image',
                        help="Image file path", required=True)
    parser.add_argument('--overlay', nargs=2, metavar=("NAME|ID", "file"), action='append',
                        help="Polygonal dataset to be rendered on top of image slices")
    parser.add_argument('--path-format',
                        help="Path format string of zoomed in region of interest screenshot files")
    parser.add_argument('--prefix', type=str,
                        help="Output directory")
    parser.add_argument('--suffix', default=('a', 'c', 's'), nargs=3, type=str,
                        help="Suffixes for each orthogonal viewing directions (axial, coronal, sagittal)")
    parser.add_argument('--zoom', type=float, default=1.,
                        help="Zoom factor by which region of interest is scaled")
    parser.add_argument('--range', nargs=2, type=float,
                        help="Minimum/maximum intensity used for greyscale color lookup table")
    parser.add_argument('--subdiv', default=0, type=int,
                        help="Number of subdivisions of each ROI half space")
    parser.add_argument('--size', default=(512, 512), nargs=2, type=int,
                        help="Size of screenshots in number of pixels")
    parser.add_argument('--shuffle-colors', action='store_true',
                        help="Randomly shuffle overlay colors")
    parser.add_argument('--use-all-colors', action='store_true',
                        help="Use all available colors for comparison, not only two")
    parser.add_argument('--line-width', default=4, type=int,
                        help="Width of bounding box outline")
    parser.add_argument('-v', '--verbose', default=0, action='count',
                        help="Verbosity of output messages")
    args = parser.parse_args()

    if args.roi > 0:
        take_screenshots_of_single_roi(args)
    else:
        call_this_script_for_each_roi(args)
