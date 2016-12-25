#!/usr/bin/python

"""Determine intensity range for screenshots."""

import os
import argparse
import mirtk


if __name__ == '__main__':
    temp = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'temp'))

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', help="Intensity image")
    parser.add_argument('-tissues', '--tissues', help="Tissue labels")
    parser.add_argument('-mask', '--mask', help="White matter mask")
    args = parser.parse_args()

    if args.mask:
        mask = args.mask
    else:
        if not args.tissues:
            raise Exception("Either -tissues or -mask argument required")
        name = os.path.basename(args.tissues)
        name, ext = os.path.splitext(name)
        if ext == '.gz':
            name = os.path.splitext(name)[0]
        mask = os.path.join(temp, name + '-white-matter-mask.nii.gz')
        mirtk.run('calculate-element-wise', args=[args.tissues], opts=[('label', 3), ('set', 1), ('pad', 0), ('out', mask, 'binary')])
        mirtk.run('transform-image', args=[mask, mask], opts={'target': args.image, 'interp': 'linear'})
    out = mirtk.check_output(['calculate-element-wise', args.image, '-mask', mask, '-normal-distribution', '-delimiter', ','])
    out = out.split(',')
    mean = float(out[0])
    stdev = float(out[1])
    print(str(mean - 5 * stdev) + " " + str(mean + 5 * stdev))
    if not args.mask:
        os.remove(mask)
