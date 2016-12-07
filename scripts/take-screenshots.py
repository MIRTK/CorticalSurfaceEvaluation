#!/usr/bin/python

"""Take screenshots of different views rendered from the selected ROIs."""

import os
import sqlite3
import argparse
import random
import string

from vtk import vtkImageData, vtkPolyData, vtkMatrix4x4, vtkNIFTIImageReader, vtkMatrixToLinearTransform, vtkXMLPolyDataReader
from mirtk.rendering.screenshots import take_orthogonal_screenshots, range_to_level_window


def rgb(r, g, b):
    return (float(r) / 255., float(g) / 255., float(b) / 255.)


# Color should be neutral and not relate to colors for scoring buttons.
color_of_single_contour_overlay = rgb(255, 245, 61)

# Colors must be distinct enough so that any pair of two colors can be
# selected randomly and the two overlays can still be easily distinguished.
#
# This list is randomly shuffled in the for loop of the main function in place
# and the first two colors are used for the two different contours.
colors = [
    rgb(61, 216, 255),  # light blue
    rgb(39, 0, 194),    # dark blue
    rgb(135, 255, 61),  # light green
    rgb(0, 194, 120),   # dark green
    rgb(255, 193, 61),  # orange
    rgb(255, 61, 242),  # pink
    rgb(247, 32, 57)    # red
]

line_width = 4
verbose = 0


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
    res = db.execute("SELECT OverlayId FROM Overlays WHERE Name = :name", dict(name=name)).fetchone()
    if not res:
        raise Exception("Unknown overlay: " + name)
    return res[0]


def color_to_byte_value(x):
    """Convert decimal color value in [0, 1] to integer in [0, 255]."""
    return max(0, min(int(round(255. * float(x))), 255))


def color_code(color):
    r = color_to_byte_value(color[0])
    g = color_to_byte_value(color[1])
    b = color_to_byte_value(color[2])
    return "#{0:02x}{1:02x}{2:02x}".format(r, g, b)


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


def insert_screenshots(db, roi_id, base, screenshots, isnew, overlays=[], colors=[]):
    """Insert screenshots into database."""
    n = 0
    num_per_view = len(screenshots) / 3
    view_ids = ('A', 'C', 'S')
    cur = db.cursor()
    try:
        for view_id in view_ids:
            for i in xrange(num_per_view):
                if isnew[n]:
                    screenshot = screenshots[n]
                    if base:
                        screenshot = os.path.relpath(screenshot, base)
                    if verbose > 1:
                        print("INSERT " + screenshot)
                    cur.execute("INSERT INTO Screenshots (FileName, ROI_Id, ViewId) VALUES (:path, :roi_id, :view_id)",
                                dict(path=screenshot, roi_id=roi_id, view_id=view_id))
                    screenshot_id = cur.lastrowid
                    for j in xrange(len(overlays)):
                        cur.execute("""
                            INSERT INTO ScreenshotOverlays (ScreenshotId, OverlayId, Color)
                            VALUES (:screenshot_id, :overlay_id, :color)
                            """, dict(screenshot_id=screenshot_id,
                                      overlay_id=overlays[j],
                                      color=color_code(colors[j])))
                n += 1
        db.commit()
    finally:
        cur.close()


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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('--image', help="Image file path", required=True)
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', help="Session ID", required=True)
    parser.add_argument('--initial', help="Initial surface mesh")
    parser.add_argument('--white-matter', '--white', dest='white', help="White matter surface mesh")
    parser.add_argument('--prefix', type=str, help="Output directory")
    parser.add_argument('--format', help="Path format string of output files")
    parser.add_argument('--range', nargs=2, type=float, help="Minimum/maximum intensity used for greyscale color lookup table")
    parser.add_argument('--subdiv', default=0, type=int, help="Number of subdivisions of each ROI half space")
    parser.add_argument('--size', default=(512, 512), nargs=2, type=int, help="Size of screenshots")
    parser.add_argument('-v', '--verbose', default=0, action='count', help="Verbosity of output messages")
    args = parser.parse_args()
    verbose = args.verbose

    args.database = os.path.abspath(args.database)
    if args.prefix:
        args.prefix = os.path.abspath(args.prefix)
    else:
        args.prefix = os.path.join(os.path.dirname(args.database),
                                   '-'.join([args.subject, args.session]),
                                   'screenshots')
    if not args.format:
        args.format = os.path.join('{prefix}', 'roi-{roi:06d}-{n:02d}_idx-{i:03d}-{j:03d}-{k:03d}_{suffix}')
    base_dir = os.path.dirname(args.database)
    if args.initial:
        initial_mesh = read_surface(os.path.abspath(args.initial))
    else:
        initial_mesh = None
    if args.white:
        white_mesh = read_surface(os.path.abspath(args.white))
    else:
        white_mesh = None

    if args.range:
        level_window = range_to_level_window(*args.range)
    else:
        level_window = None

    image, qform = read_image(os.path.abspath(args.image))
    world2image = vtkMatrixToLinearTransform()
    world2image.SetInput(qform)
    world2image.Inverse()

    db = sqlite3.connect(args.database)

    try:
        cur = db.cursor()
        try:
            initial_mesh_id = get_overlay_id(cur, 'Initial surface')
            white_mesh_id = get_overlay_id(cur, 'White matter surface')
            scan_id = get_scan_id(cur, args.subject, args.session)
        finally:
            cur.close()

        suffix = ('a', 'c', 's')
        for row in db.execute("SELECT ROI_Id, CenterX, CenterY, CenterZ, Size FROM ROIs WHERE ScanId = :scan_id",
                              dict(scan_id=scan_id)).fetchall():
            roi_id = row[0]
            roi_center = [0, 0, 0]
            roi_size = row[4]
            world2image.TransformPoint((row[1], row[2], row[3]), roi_center)
            offsets = compute_offsets(roi_size, args.subdiv)
            # screenshots without overlays
            if args.verbose > 0:
                print("Take orthogonal screenshots of ROI {roi}".format(roi=roi_id))
            path_format = partial_format(args.format, roi=roi_id, suffix="image_{suffix}")
            paths = []
            try:
                paths = take_orthogonal_screenshots(
                    image, level_window=level_window, qform=qform,
                    prefix=args.prefix, suffix=suffix, path_format=path_format,
                    center=roi_center, length=roi_size, offsets=offsets,
                    size=args.size, overwrite=False
                )
                insert_screenshots(db, roi_id=roi_id, base=base_dir, screenshots=paths[0], isnew=paths[1])
            except BaseException as e:
                for path in paths:
                        if os.path.isfile(path):
                            os.remove(path)
                raise(e)
            if args.verbose > 0:
                print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id))
            # screenshots with initial surface overlay
            if initial_mesh:
                if args.verbose > 0:
                    print("Take orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial surface contours")
                path_format = partial_format(args.format, roi=roi_id, suffix="image+initial_{suffix}")
                polydata = [initial_mesh]
                overlays = [initial_mesh_id]
                paths = []
                try:
                    paths = take_orthogonal_screenshots(
                        image, level_window=level_window, qform=qform,
                        prefix=args.prefix, suffix=suffix, path_format=path_format,
                        center=roi_center, length=roi_size, offsets=offsets,
                        polydata=polydata, colors=[color_of_single_contour_overlay],
                        line_width=line_width, size=args.size, overwrite=False
                    )
                    insert_screenshots(db, roi_id=roi_id, base=base_dir, screenshots=paths[0], isnew=paths[1],
                                       overlays=overlays, colors=[color_of_single_contour_overlay])
                except BaseException as e:
                    for path in paths:
                        if os.path.isfile(path):
                            os.remove(path)
                    raise(e)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial surface contours")
            # screenshots with white matter surface overlay
            if white_mesh:
                if args.verbose > 0:
                    print("Take orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with white matter surface contours")
                path_format = partial_format(args.format, roi=roi_id, suffix="image+white_{suffix}")
                polydata = [white_mesh]
                overlays = [white_mesh_id]
                paths = []
                try:
                    paths = take_orthogonal_screenshots(
                        image, level_window=level_window, qform=qform,
                        prefix=args.prefix, suffix=suffix, path_format=path_format,
                        center=roi_center, length=roi_size, offsets=offsets,
                        polydata=polydata, colors=[color_of_single_contour_overlay],
                        line_width=line_width, size=args.size, overwrite=False)
                    insert_screenshots(db, roi_id=roi_id, base=base_dir, screenshots=paths[0], isnew=paths[1],
                                       overlays=overlays, colors=[color_of_single_contour_overlay])
                except BaseException as e:
                    for path in paths:
                        if os.path.isfile(path):
                            os.remove(path)
                    raise(e)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with white matter surface contours")
            # screenshots with both initial and white matter surfaces overlayed
            if initial_mesh and white_mesh:
                if args.verbose > 0:
                    print("Take orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial and white matter surface contours")
                random.shuffle(colors)
                path_format = partial_format(args.format, roi=roi_id, suffix="image+initial+white_{suffix}")
                polydata = [initial_mesh, white_mesh]
                overlays = [initial_mesh_id, white_mesh_id]
                paths = []
                try:
                    paths = take_orthogonal_screenshots(
                        image, level_window=level_window, qform=qform,
                        prefix=args.prefix, suffix=suffix, path_format=path_format,
                        center=roi_center, length=roi_size, offsets=offsets,
                        polydata=polydata, colors=colors, line_width=line_width,
                        size=args.size, overwrite=False)
                    insert_screenshots(db, roi_id=roi_id, base=base_dir,
                                       screenshots=paths[0], isnew=paths[1],
                                       overlays=overlays, colors=colors)
                except BaseException as e:
                    for path in paths:
                        if os.path.isfile(path):
                            os.remove(path)
                    raise(e)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial and white matter surface contours")
    finally:
        db.close()
