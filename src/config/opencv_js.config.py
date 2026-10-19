# Copied verbatim from upstream platforms/js/opencv_js.config.py (tag 5.0.0) with exactly
# the four changes below. Everything else is left as is, so the diff stays clean when
# moving to a new upstream version.
#
# Change 1 (this comment).
#
# Change 2: dnn is removed from the makeWhiteList([...]) arguments at the end of the file.
#   This narrows the API exposed to JS; it is **not a size optimization**, which is easy to
#   get backwards: the whitelist only controls which Embind bindings are generated, not
#   whether CMake builds the module. Upstream platforms/js/build_js.py hard-codes
#   -DBUILD_opencv_dnn=ON and has no --disable_dnn option, so the dnn C++ code is in the
#   artifact either way. Shrinking it would take -DBUILD_opencv_dnn=OFF through
#   EXTRA_CMAKE_OPTIONS in build/build.sh, which is risky (objdetect's FaceDetectorYN uses
#   dnn::readNet, and mcc::CCheckerDetector can use a dnn model); see the comment on the
#   --cmake_option pass-through in build/build.sh.
#   The dnn = {...} dictionary below is kept verbatim from upstream and only no longer
#   passed to makeWhiteList(), for the same clean diff.
#
# Change 3: core also whitelists mulSpectrums and SVDecomp (next to dft).
#   The extension layer used to emulate both in hand-written JS: its mulSpectrums got the
#   DFT layout wrong and returned NaN, and its svd inlined a pure-JS Golub-Reinsch from
#   numeric.js. With the native implementations whitelisted both were removed, and
#   test/unit/native-replacements.test.js has regression assertions — **do not go back to
#   hand-written versions**. Both are declared with CV_EXPORTS_W in 5.0.0's
#   modules/core/include/opencv2/core.hpp.
#
# Change 4: the mcc entries in objdetect use the real class names.
#   Upstream lists mcc_CheckerDetector / mcc_DetectorParameters / mcc_Checker, but the
#   5.0.0 classes are mcc::CCheckerDetector / mcc::DetectorParametersMCC / mcc::CChecker,
#   so embindgen silently skipped all three and only the mcc_ColorChart enum was bound.
#   The entries here use the real names (which also needs
#   build/patches/opencv-js-mcc-bindings.patch) and add processWithROI (the CV_WRAP_AS name
#   of the ROI overload of process) and CChecker.create. Three methods are left out:
#   getListColorChecker() and draw() use std::vector<Ptr<CChecker>>, which has no Embind
#   registration, so calling them fails; getDetectionParams() returns a const reference,
#   and the select_overload signature embindgen generates for it does not compile.
#
# Upstream's own changes in the 4.14.0 → 5.0.0 baseline upgrade (not this project's
# changes; for reference):
#   Module dictionaries renamed / split: features2d → features, calib3d → _3d + calib.
#     (The variable names are only makeWhiteList arguments and embindgen merges them flat,
#     so the renaming changes nothing; the CMake switches did change, see build_js.py's
#     -DBUILD_opencv_3d / -DBUILD_opencv_features.)
#   Removed bindings: CascadeClassifier, HOGDescriptor, AKAZE, BRISK, KAZE,
#     AgastFeatureDetector, groupRectangles, readNetFromCaffe, readNetFromTorch,
#     readNetFromDarknet.
#   New whitelist entries: the mcc classes (objdetect, merged from opencv_contrib); see
#     change 4.
#   divSpectrums moved from imgproc to core.

# Classes and methods whitelist

core = {
    '': [
        'absdiff', 'add', 'addWeighted', 'bitwise_and', 'bitwise_not', 'bitwise_or', 'bitwise_xor', 'cartToPolar',
        'compare', 'convertScaleAbs', 'copyMakeBorder', 'countNonZero', 'determinant', 'dft', 'mulSpectrums', 'SVDecomp', 'divide', 'divSpectrums', 'eigen',
        'exp', 'flip', 'getOptimalDFTSize','gemm', 'hconcat', 'inRange', 'invert', 'kmeans', 'log', 'magnitude',
        'max', 'mean', 'meanStdDev', 'merge', 'min', 'minMaxLoc', 'mixChannels', 'multiply', 'norm', 'normalize',
        'perspectiveTransform', 'polarToCart', 'pow', 'randn', 'randu', 'reduce', 'repeat', 'rotate', 'setIdentity', 'setRNGSeed',
        'solve', 'solvePoly', 'split', 'sqrt', 'subtract', 'trace', 'transform', 'transpose', 'vconcat',
        'setLogLevel', 'getLogLevel',
        'LUT',
    ],
    'Algorithm': [],
}

imgproc = {
    '': [
        'adaptiveThreshold',
        'applyColorMap',
        'approxPolyDP',
        'approxPolyN',
        'arcLength',
        'arrowedLine',
        'bilateralFilter',
        'blendLinear',
        'blur',
        'boundingRect',
        'boxFilter',
        'calcBackProject',
        'calcHist',
        'Canny',
        'circle',
        'clipLine',
        'compareHist',
        'connectedComponents',
        'connectedComponentsWithStats',
        'contourArea',
        'convertMaps',
        'convexHull',
        'convexityDefects',
        'cornerHarris',
        'cornerMinEigenVal',
        'createCLAHE',
        'createHanningWindow',
        'createLineSegmentDetector',
        'cvtColor',
        'demosaicing',
        'dilate',
        'distanceTransform',
        'distanceTransformWithLabels',
        'drawContours',
        'drawMarker',
        'ellipse',
        'ellipse2Poly',
        'equalizeHist',
        'erode',
        'fillConvexPoly',
        'fillPoly',
        'filter2D',
        'findContours',
        'findContoursLinkRuns',
        'fitEllipse',
        'fitEllipseAMS',
        'fitEllipseDirect',
        'fitLine',
        'floodFill',
        'GaussianBlur',
        'getAffineTransform',
        'getFontScaleFromHeight',
        'getPerspectiveTransform',
        'getRectSubPix',
        'getRotationMatrix2D',
        'getStructuringElement',
        'goodFeaturesToTrack',
        'grabCut',
        'HoughLines',
        'HoughLinesP',
        'HoughCircles',
        'HuMoments',
        'integral',
        'integral2',
        'intersectConvexConvex',
        'invertAffineTransform',
        'isContourConvex',
        'Laplacian',
        'line',
        'matchShapes',
        'matchTemplate',
        'medianBlur',
        'minAreaRect',
        'minEnclosingCircle',
        'minEnclosingTriangle',
        'moments',
        'morphologyEx',
        'pointPolygonTest',
        'polylines',
        'preCornerDetect',
        'putText',
        'pyrDown',
        'pyrUp',
        'rectangle',
        'remap',
        'resize',
        'rotatedRectangleIntersection',
        'Scharr',
        'sepFilter2D',
        'Sobel',
        'spatialGradient',
        'sqrBoxFilter',
        'stackBlur',
        'threshold',
        'warpAffine',
        'warpPerspective',
        'warpPolar',
        'watershed',
    ],
    'CLAHE': ['apply', 'collectGarbage', 'getClipLimit', 'getTilesGridSize', 'setClipLimit', 'setTilesGridSize'],
    'segmentation_IntelligentScissorsMB': [
        'IntelligentScissorsMB',
        'setWeights',
        'setGradientMagnitudeMaxLimit',
        'setEdgeFeatureZeroCrossingParameters',
        'setEdgeFeatureCannyParameters',
        'applyImage',
        'applyImageFeatures',
        'buildMap',
        'getContour'
    ],
}

objdetect = {'': ['getPredefinedDictionary', 'extendDictionary',
                  'drawDetectedMarkers', 'generateImageMarker', 'drawDetectedCornersCharuco',
                  'drawDetectedDiamonds'],
             'GraphicalCodeDetector': ['decode', 'detect', 'detectAndDecode', 'detectMulti', 'decodeMulti', 'detectAndDecodeMulti'],
             'QRCodeDetector': ['QRCodeDetector', 'decode', 'detect', 'detectAndDecode', 'detectMulti', 'decodeMulti', 'detectAndDecodeMulti', 'decodeCurved', 'detectAndDecodeCurved', 'setEpsX', 'setEpsY'],
             'aruco_PredefinedDictionaryType': [],
             'aruco_Dictionary': ['Dictionary', 'getDistanceToId', 'generateImageMarker', 'getByteListFromBits', 'getBitsFromByteList'],
             'aruco_Board': ['Board', 'matchImagePoints', 'generateImage'],
             'aruco_GridBoard': ['GridBoard', 'generateImage', 'getGridSize', 'getMarkerLength', 'getMarkerSeparation', 'matchImagePoints'],
             'aruco_CharucoParameters': ['CharucoParameters'],
             'aruco_CharucoBoard': ['CharucoBoard', 'generateImage', 'getChessboardCorners', 'getNearestMarkerCorners', 'checkCharucoCornersCollinear', 'matchImagePoints', 'getLegacyPattern', 'setLegacyPattern'],
             'aruco_DetectorParameters': ['DetectorParameters'],
             'aruco_RefineParameters': ['RefineParameters'],
             'aruco_ArucoDetector': ['ArucoDetector', 'detectMarkers', 'refineDetectedMarkers', 'setDictionary', 'setDetectorParameters', 'setRefineParameters'],
             'aruco_CharucoDetector': ['CharucoDetector', 'setBoard', 'setCharucoParameters', 'setDetectorParameters', 'setRefineParameters', 'detectBoard', 'detectDiamonds'],
             'QRCodeDetectorAruco_Params': ['Params'],
             'QRCodeDetectorAruco': ['QRCodeDetectorAruco', 'decode', 'detect', 'detectAndDecode', 'detectMulti', 'decodeMulti', 'detectAndDecodeMulti', 'setDetectorParameters', 'setArucoParameters'],
             'barcode_BarcodeDetector': ['BarcodeDetector', 'decode', 'detect', 'detectAndDecode', 'detectMulti', 'decodeMulti', 'detectAndDecodeMulti', 'decodeWithType', 'detectAndDecodeWithType'],
             'mcc_CCheckerDetector': ['process', 'processWithROI', 'getBestColorChecker', 'create', 'getRefColors', 'setDetectionParams', 'setColorChartType', 'getColorChartType', 'setUseDnnModel', 'getUseDnnModel'],
             'mcc_DetectorParametersMCC': ['DetectorParametersMCC'],
             'mcc_CChecker': ['create', 'setTarget', 'setBox', 'setChartsRGB', 'setChartsYCbCr', 'setCost', 'setCenter', 'getTarget', 'getBox', 'getColorCharts', 'getChartsRGB', 'getChartsYCbCr', 'getCost', 'getCenter'],
             'FaceDetectorYN': ['setInputSize', 'getInputSize', 'setScoreThreshold', 'getScoreThreshold', 'setNMSThreshold', 'getNMSThreshold',
                                'setTopK', 'getTopK', 'detect', 'create'],
}

video = {
    '': [
        'CamShift',
        'calcOpticalFlowFarneback',
        'calcOpticalFlowPyrLK',
        'createBackgroundSubtractorMOG2',
        'findTransformECC',
        'meanShift',
    ],
    'BackgroundSubtractorMOG2': ['BackgroundSubtractorMOG2', 'apply'],
    'BackgroundSubtractor': ['apply', 'getBackgroundImage'],
    # issue #21070: 'Tracker': ['init', 'update'],
    'TrackerMIL': ['create'],
    'TrackerMIL_Params': [],
}

dnn = {'dnn_Net': ['setInput', 'forward', 'setPreferableBackend','getUnconnectedOutLayersNames'],
       '': ['readNetFromTensorflow',
            'readNetFromONNX', 'readNetFromTFLite', 'readNet', 'blobFromImage']}

features = {'Feature2D': ['detect', 'compute', 'detectAndCompute', 'descriptorSize', 'descriptorType', 'defaultNorm', 'empty', 'getDefaultName'],
              'ORB': ['create', 'setMaxFeatures', 'setScaleFactor', 'setNLevels', 'setEdgeThreshold', 'setFastThreshold', 'setFirstLevel', 'setWTA_K', 'setScoreType', 'setPatchSize', 'getFastThreshold', 'getDefaultName'],
              'MSER': ['create', 'detectRegions', 'setDelta', 'getDelta', 'setMinArea', 'getMinArea', 'setMaxArea', 'getMaxArea', 'setPass2Only', 'getPass2Only', 'getDefaultName'],
              'FastFeatureDetector': ['create', 'setThreshold', 'getThreshold', 'setNonmaxSuppression', 'getNonmaxSuppression', 'setType', 'getType', 'getDefaultName'],
              'GFTTDetector': ['create', 'setMaxFeatures', 'getMaxFeatures', 'setQualityLevel', 'getQualityLevel', 'setMinDistance', 'getMinDistance', 'setBlockSize', 'getBlockSize', 'setHarrisDetector', 'getHarrisDetector', 'setK', 'getK', 'getDefaultName'],
              'SimpleBlobDetector': ['create', 'setParams', 'getParams', 'getDefaultName'],
              'SimpleBlobDetector_Params': [],
              'DescriptorMatcher': ['add', 'clear', 'empty', 'isMaskSupported', 'train', 'match', 'knnMatch', 'radiusMatch', 'clone', 'create'],
              'BFMatcher': ['isMaskSupported', 'create'],
              '': ['drawKeypoints', 'drawMatches', 'drawMatchesKnn']}

photo = {'': ['createAlignMTB', 'createCalibrateDebevec', 'createCalibrateRobertson', \
              'createMergeDebevec', 'createMergeMertens', 'createMergeRobertson', \
              'createTonemapDrago', 'createTonemapMantiuk', 'createTonemapReinhard', 'inpaint'],
        'CalibrateCRF': ['process'],
        'AlignExposures': ['process'],
        'AlignMTB' : ['calculateShift', 'shiftMat', 'computeBitmaps', 'getMaxBits', 'setMaxBits', \
                      'getExcludeRange', 'setExcludeRange', 'getCut', 'setCut'],
        'CalibrateDebevec' : ['getLambda', 'setLambda', 'getSamples', 'setSamples', 'getRandom', 'setRandom'],
        'CalibrateRobertson' : ['getMaxIter', 'setMaxIter', 'getThreshold', 'setThreshold', 'getRadiance'],
        'MergeExposures' : ['process'],
        'MergeDebevec' : ['process'],
        'MergeMertens' : ['process', 'getContrastWeight', 'setContrastWeight', 'getSaturationWeight', \
                          'setSaturationWeight', 'getExposureWeight', 'setExposureWeight'],
        'MergeRobertson' : ['process'],
        'Tonemap' : ['process' , 'getGamma', 'setGamma'],
        'TonemapDrago' : ['getSaturation', 'setSaturation', 'getBias', 'setBias', \
                          'getSigmaColor', 'setSigmaColor', 'getSigmaSpace','setSigmaSpace'],
        'TonemapMantiuk' : ['getScale', 'setScale', 'getSaturation', 'setSaturation'],
        'TonemapReinhard' : ['getIntensity', 'setIntensity', 'getLightAdaptation', 'setLightAdaptation', \
                             'getColorAdaptation', 'setColorAdaptation']
        }

_3d = {
    '': [
        'findHomography',
        'calibrateCameraExtended',
        'drawFrameAxes',
        'estimateAffine2D',
        'getDefaultNewCameraMatrix',
        'initUndistortRectifyMap',
        'Rodrigues',
        'solvePnP',
        'solvePnPRansac',
        'solvePnPRefineLM',
        'projectPoints',
        'undistort',
    ],
}

calib = {
    '': [

        # cv::fisheye namespace
        'fisheye_initUndistortRectifyMap',
        'fisheye_projectPoints',
    ],
    'UsacParams': ['UsacParams']
}


white_list = makeWhiteList([core, imgproc, objdetect, video, features, photo, _3d, calib])

# namespace_prefix_override['dnn'] = ''  # compatibility stuff (enabled by default)
# namespace_prefix_override['aruco'] = ''  # compatibility stuff (enabled by default)
