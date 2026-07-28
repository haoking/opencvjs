# 相对上游 platforms/js/opencv_js.config.py 的改动只有两处：本段注释，以及
# 文件末尾 makeWhiteList([...]) 的参数里去掉了 dnn。其余逐字同步，便于跟进新版本。
#
# 相对上游还多放行了 core 的 mulSpectrums 与 SVDecomp（紧邻 dft）：扩展层原本用
# 手写 JS 模拟这两者——mulSpectrums 的 DFT 布局算错导致返回 NaN，svd 则内联了一份
# numeric.js 的纯 JS Golub-Reinsch。放行原生实现后两者都可删除。
#
# 去掉 dnn 是为了收窄暴露给 JS 的 API 面，**不是体积优化**——这一点极易搞反：
# 白名单只控制 embind 绑定的生成，不影响 CMake 是否编译该模块。上游
# platforms/js/build_js.py:126 硬编码 -DBUILD_opencv_dnn=ON 且没有 --disable_dnn
# 选项，所以 dnn 的 C++ 代码仍会进产物，体积不会因为这里少一个名字而显著下降。
# 真要减体积得靠 build/build.sh 的 EXTRA_CMAKE_OPTIONS 传 -DBUILD_opencv_dnn=OFF，
# 但有风险（objdetect 的 FaceDetectorYN 走 dnn::readNet），见 build/build.sh 中
# CMAKE_OPTION_ARG 上方的注释。
#
# 下方 dnn = {...} 字典本身逐字保留自上游，只是不再传进 makeWhiteList()——
# 保留它是为了跟进上游新版本时 diff 保持干净。

# Classes and methods whitelist

core = {
    '': [
        'absdiff', 'add', 'addWeighted', 'bitwise_and', 'bitwise_not', 'bitwise_or', 'bitwise_xor', 'cartToPolar',
        'compare', 'convertScaleAbs', 'copyMakeBorder', 'countNonZero', 'determinant', 'dft', 'mulSpectrums', 'SVDecomp', 'divide', 'eigen',
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
        'divSpectrums',
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

objdetect = {'': ['groupRectangles', 'getPredefinedDictionary', 'extendDictionary',
                  'drawDetectedMarkers', 'generateImageMarker', 'drawDetectedCornersCharuco',
                  'drawDetectedDiamonds'],
             'HOGDescriptor': ['load', 'HOGDescriptor', 'getDefaultPeopleDetector', 'getDaimlerPeopleDetector', 'setSVMDetector', 'detectMultiScale'],
             'CascadeClassifier': ['load', 'detectMultiScale2', 'CascadeClassifier', 'detectMultiScale3', 'empty', 'detectMultiScale'],
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
       '': ['readNetFromCaffe', 'readNetFromTensorflow', 'readNetFromTorch', 'readNetFromDarknet',
            'readNetFromONNX', 'readNetFromTFLite', 'readNet', 'blobFromImage']}

features2d = {'Feature2D': ['detect', 'compute', 'detectAndCompute', 'descriptorSize', 'descriptorType', 'defaultNorm', 'empty', 'getDefaultName'],
              'BRISK': ['create', 'getDefaultName'],
              'ORB': ['create', 'setMaxFeatures', 'setScaleFactor', 'setNLevels', 'setEdgeThreshold', 'setFastThreshold', 'setFirstLevel', 'setWTA_K', 'setScoreType', 'setPatchSize', 'getFastThreshold', 'getDefaultName'],
              'MSER': ['create', 'detectRegions', 'setDelta', 'getDelta', 'setMinArea', 'getMinArea', 'setMaxArea', 'getMaxArea', 'setPass2Only', 'getPass2Only', 'getDefaultName'],
              'FastFeatureDetector': ['create', 'setThreshold', 'getThreshold', 'setNonmaxSuppression', 'getNonmaxSuppression', 'setType', 'getType', 'getDefaultName'],
              'AgastFeatureDetector': ['create', 'setThreshold', 'getThreshold', 'setNonmaxSuppression', 'getNonmaxSuppression', 'setType', 'getType', 'getDefaultName'],
              'GFTTDetector': ['create', 'setMaxFeatures', 'getMaxFeatures', 'setQualityLevel', 'getQualityLevel', 'setMinDistance', 'getMinDistance', 'setBlockSize', 'getBlockSize', 'setHarrisDetector', 'getHarrisDetector', 'setK', 'getK', 'getDefaultName'],
              'SimpleBlobDetector': ['create', 'setParams', 'getParams', 'getDefaultName'],
              'SimpleBlobDetector_Params': [],
              'KAZE': ['create', 'setExtended', 'getExtended', 'setUpright', 'getUpright', 'setThreshold', 'getThreshold', 'setNOctaves', 'getNOctaves', 'setNOctaveLayers', 'getNOctaveLayers', 'setDiffusivity', 'getDiffusivity', 'getDefaultName'],
              'AKAZE': ['create', 'setDescriptorType', 'getDescriptorType', 'setDescriptorSize', 'getDescriptorSize', 'setDescriptorChannels', 'getDescriptorChannels', 'setThreshold', 'getThreshold', 'setNOctaves', 'getNOctaves', 'setNOctaveLayers', 'getNOctaveLayers', 'setDiffusivity', 'getDiffusivity', 'getDefaultName'],
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

calib3d = {
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

        # cv::fisheye namespace
        'fisheye_initUndistortRectifyMap',
        'fisheye_projectPoints',
    ],
    'UsacParams': ['UsacParams']
}

white_list = makeWhiteList([core, imgproc, objdetect, video, features2d, photo, calib3d])

# namespace_prefix_override['dnn'] = ''  # compatibility stuff (enabled by default)
# namespace_prefix_override['aruco'] = ''  # compatibility stuff (enabled by default)
