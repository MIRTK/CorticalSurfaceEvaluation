#!/usr/bin/python

"""Take screenshots of different views rendered from the selected ROIs."""

import os
import sqlite3
import argparse

from vtk import vtkNIFTIImageReader, vtkMatrixToLinearTransform, vtkXMLPolyDataReader
from mirtk.rendering.screenshots import (take_orthogonal_screenshots, range_to_level_window,
                                         nearest_voxel, point_to_index)


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


def any_screenshot_exists(prefix, suffix):
    """Check if any of the screenshots already exists."""
    for s in suffix:
        if os.path.isfile(prefix + s + '.png'):
            return True
    return False


def insert_screenshots(db, roi_id, base, prefix, suffix, overlays=[], colors=[]):
    """Insert screenshots into database."""
    view_ids = ('A', 'C', 'S')
    if base:
        prefix = os.path.relpath(prefix, base)
    for i in range(3):
        db.execute("INSERT INTO Screenshots (FileName, ROI_Id, ViewId) VALUES (:path, :roi_id, :view_id)",
                   dict(path=(prefix + suffix[i] + '.png'), roi_id=roi_id, view_id=view_ids[i]))
        screenshot_id = db.lastrowid
        for j in range(len(overlays)):
            db.execute("INSERT INTO ScreenshotOverlays (ScreenshotId, OverlayId, Color) VALUES (:screenshot_id, :overlay_id, :color)",
                       dict(screenshot_id=screenshot_id, overlay_id=overlays[j], color=color_code(colors[j])))


def read_image(fname):
    """Read image from file."""
    reader = vtkNIFTIImageReader()
    reader.SetFileName(fname)
    reader.UpdateWholeExtent()
    return (reader.GetOutput(), reader.GetQFormMatrix())


def read_surface(fname):
    """Read surface mesh from file."""
    reader = vtkXMLPolyDataReader()
    reader.SetFileName(fname)
    reader.UpdateWholeExtent()
    return reader.GetOutput()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', help="SQLite database file")
    parser.add_argument('--image', help="Image file path", required=True)
    parser.add_argument('--subject', help="Subject ID", required=True)
    parser.add_argument('--session', help="Session ID", required=True)
    parser.add_argument('--initial', help="Initial surface mesh")
    parser.add_argument('--white-matter', '--white', dest='white', help="White matter surface mesh")
    parser.add_argument('--prefix', help="Common prefix of output files, including directory path")
    parser.add_argument('--range', nargs=2, type=float, help="Minimum/maximum intensity used for greyscale color lookup table")
    parser.add_argument('--size', default=(512, 512), nargs=2, type=int, help="Size of screenshots")
    parser.add_argument('-v', '--verbose', default=0, action='count', help="Verbosity of output messages")
    args = parser.parse_args()

    args.database = os.path.abspath(args.database)
    if not args.prefix:
        args.prefix = os.path.join(os.path.dirname(args.database),
                                   '-'.join([args.subject, args.session]),
                                   'screenshots', 'roi-{roi:06d}_idx-{i:03d}-{j:03d}-{k:03d}')
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

    con = sqlite3.connect(args.database)
    cur = con.cursor()

    initial_mesh_id = get_overlay_id(cur, 'Initial surface')
    white_mesh_id = get_overlay_id(cur, 'White matter surface')

    scan_id = get_scan_id(cur, args.subject, args.session)
    for row in cur.execute("SELECT ROI_Id, CenterX, CenterY, CenterZ, Size FROM ROIs WHERE ScanId = :scan_id",
                           dict(scan_id=scan_id)).fetchall():
        roi_id = row[0]
        roi_center = [0, 0, 0]
        roi_size = row[4]
        world2image.TransformPoint((row[1], row[2], row[3]), roi_center)
        index = nearest_voxel(point_to_index(roi_center, image.GetOrigin(), image.GetSpacing()))
        roi_prefix = args.prefix.format(roi=roi_id, x=roi_center[0], y=roi_center[1], z=roi_center[2], i=index[0], j=index[1], k=index[2])
        suffix = ('_axial', '_coronal', '_sagittal')
        # screenshots without overlays
        prefix = roi_prefix + '_image'
        if any_screenshot_exists(prefix, suffix):
            if args.verbose > 0:
                print("At least one screenshot with prefix {} already exists".format(prefix))
        else:
            take_orthogonal_screenshots(image, qform=qform, prefix=prefix, suffix=suffix,
                                        center=roi_center, length=roi_size, size=args.size,
                                        level_window=level_window)
            if args.verbose > 0:
                print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id))
                if args.verbose > 1:
                    print("\tPrefix = " + prefix)
            insert_screenshots(cur, roi_id=roi_id, base=base_dir, prefix=prefix, suffix=suffix)
        # screenshots with initial surface overlay
        if initial_mesh:
            prefix = roi_prefix + '_image_with_initial_surface'
            if any_screenshot_exists(prefix, suffix):
                if args.verbose > 0:
                    print("At least one screenshot with prefix {} already exists".format(prefix))
            else:
                polydata = [initial_mesh]
                overlays = [initial_mesh_id]
                colors = [(0, 0, 1)]
                take_orthogonal_screenshots(image, qform=qform, prefix=prefix, suffix=suffix,
                                            center=roi_center, length=roi_size, size=args.size,
                                            polydata=polydata, colors=colors, level_window=level_window)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial surface contours")
                    if args.verbose > 1:
                        print("\tPrefix = " + prefix)
                insert_screenshots(cur, roi_id=roi_id, base=base_dir, prefix=prefix, suffix=suffix, overlays=overlays, colors=colors)
        # screenshots with white matter surface overlay
        if white_mesh:
            prefix = roi_prefix + '_image_with_white_matter_surface'
            if any_screenshot_exists(prefix, suffix):
                if args.verbose > 0:
                    print("At least one screenshot with prefix {} already exists".format(prefix))
            else:
                polydata = [white_mesh]
                overlays = [white_mesh_id]
                colors = [(0, 0, 1)]
                take_orthogonal_screenshots(image, qform=qform, prefix=prefix, suffix=suffix,
                                            center=roi_center, length=roi_size, size=args.size,
                                            polydata=polydata, colors=colors, level_window=level_window)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with white matter surface contours")
                    if args.verbose > 1:
                        print("\tPrefix = " + prefix)
                insert_screenshots(cur, roi_id=roi_id, base=base_dir, prefix=prefix, suffix=suffix, overlays=overlays, colors=colors)
        # screenshots with both initial and white matter surfaces overlayed
        if initial_mesh and white_mesh:
            prefix = roi_prefix + '_image_with_initial_and_white_matter_surface'
            if any_screenshot_exists(prefix, suffix):
                if args.verbose > 0:
                    print("At least one screenshot with prefix {} already exists".format(prefix))
            else:
                polydata = [initial_mesh, white_mesh]
                overlays = [initial_mesh_id, white_mesh_id]
                colors = [(1, 0, 0), (0, 1, 0)]
                take_orthogonal_screenshots(image, qform=qform, prefix=prefix, suffix=suffix,
                                            center=roi_center, length=roi_size, size=args.size,
                                            polydata=polydata, colors=colors, level_window=level_window)
                if args.verbose > 0:
                    print("Saved orthogonal screenshots of ROI {roi}".format(roi=roi_id) +
                          " with initial and white matter surface contours")
                    if args.verbose > 1:
                        print("\tPrefix = " + prefix)
                insert_screenshots(cur, roi_id=roi_id, base=base_dir, prefix=prefix, suffix=suffix, overlays=overlays, colors=colors)

    con.commit()
    cur.close()
    con.close()
