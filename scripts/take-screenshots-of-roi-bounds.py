#!/usr/bin/python

"""Take zoomed out screenshots of orthogonal ROI slices with overlaied bounding boxes.

FIXME: This script is run in a separate Python process for each ROI because there
       seems to be a memory leak in the code that renders the screenshots using
       VTK offscreen rendering.
"""

import os
import sys
import sqlite3
import argparse
import string
import subprocess

from vtk import (vtkImageData, vtkPolyData, vtkCubeSource,
                 vtkMatrix4x4, vtkMatrixToLinearTransform,
                 vtkTransformPolyDataFilter, vtkNIFTIImageReader)

from mirtk.rendering.screenshots import take_orthogonal_screenshots, range_to_level_window


def rgb(r, g, b):
    """Convert RGB byte value in [0, 255] to float in [0, 1]."""
    return (float(r) / 255., float(g) / 255., float(b) / 255.)


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


def bounding_cube(center, length):
    """Create bounding box cube for given ROI."""
    source = vtkCubeSource()
    source.SetCenter(center)
    source.SetXLength(length)
    source.SetYLength(length)
    source.SetZLength(length)
    source.Update()
    cube = vtkPolyData()
    cube.DeepCopy(source.GetOutput())
    return cube


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


def take_screenshots_of_roi_bounds(image, transform, level_window,
                                   center, length, offsets,
                                   size, line_width, color,
                                   prefix, suffix, path_format,
                                   zoom_out_factor=4, overwrite=False):
    """Take screenshot of zoomed out ROI with bounding box of ROI overlayed."""
    if zoom_out_factor <= 0.:
        zoom_out_factor = 1000.
        trim = True
    else:
        if zoom_out_factor <= 1.:
            sys.stderr.write("Warning: Zoom out factor should be greater than 1!\n")
        trim = False
    cube = bounding_cube(center, length)
    transformer = vtkTransformPolyDataFilter()
    transformer.SetInputData(cube)
    transformer.SetTransform(transform)
    transformer.Update()
    output = vtkPolyData()
    output.DeepCopy(transformer.GetOutput())
    cube = output
    return take_orthogonal_screenshots(
        image, qform=transform.GetMatrix(), level_window=level_window,
        prefix=prefix, suffix=suffix, path_format=path_format,
        center=center, length=(zoom_out_factor * length), offsets=offsets,
        polydata=[cube], colors=[color], line_width=line_width,
        size=size, trim=trim, overwrite=overwrite
    )


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
            path = os.path.relpath(os.path.realpath(path), os.path.realpath(base))
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
    color = rgb(*args.color)
    args.database = os.path.abspath(args.database)
    base_dir = os.path.dirname(args.database)

    image, qform = read_image(os.path.abspath(args.image))
    image2world = vtkMatrixToLinearTransform()
    image2world.SetInput(qform)
    image2world.Update()
    world2image = image2world.GetLinearInverse()

    db = sqlite3.connect(args.database)

    if args.scan > 0:
        scan_id = args.scan
    else:
        scan_id = get_scan_id(db, args.subject, args.session)

    if args.prefix:
        prefix = os.path.abspath(args.prefix)
        prefix = partial_format(prefix, subject=args.subject, session=args.session, scan=scan_id, roi=args.roi)
    else:
        prefix = os.path.join(os.path.dirname(args.database),
                              '-'.join([args.subject, args.session]),
                              'screenshots', 'roi-bounds')
    if not args.path_format:
        args.path_format = os.path.join('{prefix}', 'roi-{roi:06d}-{n:02d}_{suffix}.png')
    if args.range:
        level_window = range_to_level_window(*args.range)
    else:
        level_window = None

    try:
        if args.verbose > 0:
            print("Take screenshots of bounding boxes of ROI {roi}".format(roi=args.roi))
        cur = db.cursor()
        try:
            overlay_id = get_overlay_id(cur, 'ROI Bounds')
        finally:
            cur.close()
        row = db.execute("SELECT CenterX, CenterY, CenterZ, Span FROM ROIs WHERE ROI_Id = " + str(args.roi)).fetchone()
        span = row[3]
        center = [0, 0, 0]
        world2image.TransformPoint((row[0], row[1], row[2]), center)
        if len(args.offsets) > 0:
            offsets = args.offsets
        else:
            offsets = compute_offsets(span, args.subdiv)
        screenshots = []
        path_format = partial_format(args.path_format, subject=args.subject, session=args.session, roi=args.roi)
        try:
            screenshots = take_screenshots_of_roi_bounds(
                image, transform=image2world, level_window=level_window,
                center=center, length=span, offsets=offsets, zoom_out_factor=args.zoom_out_factor,
                size=args.size, line_width=args.line_width, color=color,
                prefix=prefix, suffix=args.suffix, path_format=path_format, overwrite=False
            )
            insert_screenshots(
                db, roi_id=args.roi, base=base_dir, screenshots=screenshots,
                overlays=[overlay_id], colors=[color], verbose=(args.verbose - 1)
            )
        except BaseException as e:
            for screenshot in screenshots:
                path = screenshot[0]
                if os.path.isfile(path):
                    os.remove(path)
            raise(e)
        if args.verbose > 0:
            print("Saved screenshots of bounding boxes of ROI {roi}".format(roi=args.roi))
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
            '--image', args.image,
            '--zoom-out-factor', args.zoom_out_factor,
            '--color', args.color[0], args.color[1], args.color[2],
            '--line-width', args.line_width
        ]
        if args.path_format:
            argv.extend(['--path-format', args.path_format])
        if args.prefix:
            argv.extend(['--prefix', args.prefix])
        if args.suffix:
            argv.extend(['--suffix', args.suffix[0], args.suffix[1], args.suffix[2]])
        if args.range:
            argv.extend(['--range', args.range[0], args.range[1]])
        if args.subdiv:
            argv.extend(['--subdiv', args.subdiv])
        if len(args.offsets) > 0:
            argv.append('--offsets')
            argv.extend(args.offsets)
        if args.size:
            argv.extend(['--size', args.size[0], args.size[1]])
        if args.use_all_colors:
            argv.append('--use-all-colors')
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
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('--scan', type=int, default=0, help="ID of subject/session scan")
    parser.add_argument('--roi', type=int, default=0, help="ID of region of interest")
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', help="Session ID", required=True)
    parser.add_argument('--image', help="Image file path", required=True)
    parser.add_argument('--path-format', help="Path format string of zoomed in region of interest screenshot files")
    parser.add_argument('--prefix', type=str, help="Output directory")
    parser.add_argument('--suffix', default=('a', 'c', 's'), nargs=3, type=str,
                        help="Suffixes for each orthogonal viewing directions (axial, coronal, sagittal)")
    parser.add_argument('--zoom-out-factor', default=0., type=float, help="Zoom out factor, trim to image when non-positive")
    parser.add_argument('--range', nargs=2, type=float, help="Minimum/maximum intensity used for greyscale color lookup table")
    parser.add_argument('--subdiv', default=0, type=int, help="Number of subdivisions of each ROI half space")
    parser.add_argument('--offsets', default=[], nargs='+', type=int, help="Slice offsets from ROI center point")
    parser.add_argument('--size', default=(512, 512), nargs=2, type=int, help="Size of screenshots in number of pixels")
    parser.add_argument('--color', default=(247, 32, 57), nargs=3, type=int, help="Color of bounding box")
    parser.add_argument('--line-width', default=4, type=int, help="Width of bounding box outline")
    parser.add_argument('--use-all-colors', action='store_true', help="Use all available colors for comparison, not only two")
    parser.add_argument('-v', '--verbose', default=0, action='count', help="Verbosity of output messages")
    args = parser.parse_args()
    if args.roi > 0:
        take_screenshots_of_single_roi(args)
    else:
        call_this_script_for_each_roi(args)
