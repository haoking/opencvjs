# opencvjs
![OpenCV 4.0.0+](https://img.shields.io/badge/OpenCV-4.0.0%2B-green.svg)

Complete opencvjs for single channel.(With the lastest OpenCV 4.0.0+)

The official opencv.js stoped update. Moreover, it still has many errors from the last version.

This project is inherited from official opencv.js.

Which means all of the methods in opencv.js works here, also, fix most of the errors, especial for the single channel. As most of the project is using the gray image and cv.CV_32FC1.

Moreover, the version of the full channel and the full data type will come after the first release.

## Features

- [x] OpenCVJS writen by native JS which means this project can be used directly in the browser or JS project, or node.js
- [x] OpenCVJS is the easiest to install as one .js file
- [x] OpenCVJS has achieved most of the OpenCV C++ functions
- [x] Some of the bad efficient methods implemented on js encapsulate the c++ method directly by using WebAssembly
- [x] Almost every method's performance is faster than total JS implemented
- [x] Performance is acceptted on web real-time face tracking
- [x] The fasttest matix operate functions
- [x] Every funcation is tested

## Requirements

- Native JS
- OpenCV 4.0.0+

## Communication

- If you **found a bug**, open an issue.
- If you **have a feature request**, open an issue.
- If you **want to contribute**, submit a pull request.

## Installation

### Javascript

Async invoke opencv.js:

```javascript
<script async src="opencv.js" onload="onOpenCVReady();" type="text/javascript"></script>
```

Do coding after  `onOpenCVReady`:

```ruby
<script type="text/javascript">
    function onOpenCVReady() 
	{  
        //...
      	//do something...
   	}
</script>
```

------

## Usage

### Commonly

**add()**

void cv.add(src1, src2, dst) 

( dst = src1 + src2 )

src1		First input mat

src2		Second input mat

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.add(mat1, mat2, dst);
mat1.delete(), mat2.delete();
//Don't forget to delete cv.Mat when you don't want to use it any more.
console.log("dst::" + dst.data32F);//dst::2,4,6,8,10,12,14,16,18
```

**addConstant()**

void cv.addConstant(src1, constant, dst)

( dst = src1 + constant )

src1			First input mat

constant	Constant added to each element.

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.addConstant(mat1, 10, dst);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::11,12,13,14,15,16,17,18,19
```
**subtract()**

void cv.subtract(src1, src2, dst)

( dst = src1 - src2 )

src1		First input mat

src2		Second input mat

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.subtract(mat1, mat2, dst);
mat1.delete(), mat2.delete(); 
//Don't forget to delete cv.Mat when you don't want to use it any more.
console.log("dst::" + dst.data32F);//dst::0,0,0,0,0,0,0,0,0
```

**constantSubtract()**

void cv.constantSubtract(constant, src1, dst)

( dst = constant - src1 )

constant	Constant subtract each element.

src1			First input mat

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.constantSubtract(10, mat1, dst);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::9,8,7,6,5,4,3,2,1
```

**mul()**

void cv.mul(src1, src2, dst)

( dst = src1 * src1 )

src1		First input mat

src2		Second input mat

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.mul(mat1, mat2, dst);
mat1.delete(), mat2.delete();
console.log("dst::" + dst.data32F);//dst::30,36,42,66,81,96,102,126,150
```

**mul()**

Cv.Mat dst = src1.mul(src2, scale)

( dst = src1 • src2*scale )

src1		First input mat

src2		Second input mat

scale 	Optional scale factor.

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.mul(mat2, 2);
mat1.delete(), mat2.delete();
console.log("dst::" + dst.data32F);//dst::2,8,18,32,50,72,98,128,162
```

**mulConstant()**

void cv.mulConstant(src1, constant, dst)

( dst = src1 * constant )

src1			First input mat

constant	Constant added to each element.

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.mulConstant(mat1, 10, dst);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::10,20,30,40,50,60,70,80,90
```

**divide()**

void cv.divide(src1, src2, dst)

( dst = src1 / src1 )

src1		First input mat

src2		Second input mat

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.divide(mat1, mat2, dst);
mat1.delete(), mat2.delete();
console.log("dst::" + dst.data32F);//dst::1,1,1,1,1,1,1,1,1
```

**constantDivide()**

void cv.constantDivide(constant, src1, dst)

( dst = constant / src1 )

constant	Constant subtract each element.

src1			First input mat

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.constantDivide(10, mat1, dst);
mat1.delete();
console.log("dst::" + dst.data32F);
//dst::10,5,3.3333332538604736,2.5,2,1.6666666269302368,1.4285714626312256,1.25,1.1111111640930176
```

**reshape()**

Cv.Mat dst = cv.reshape(src1, rows)

src1		First input mat

rows	Reshape to rows

dst		Output mat that has the same data of src1, but the row is equal to input rows

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.reshape(mat1, 1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,4,5,6,7,8,9:::1:::9
dst.delete();//Don't forget to delete cv.Mat when you don't want to use it any more.
```

**sum()**

Float dst = sum.reshape(src1)

src1		First input mat

dst		Sum of src1 data

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.sum(mat1);
mat1.delete();
console.log("dst::" + dst);//dst::45
```

**norm()**

Float dst = cv.norm(src1)

src1		First input mat

dst		Norm of src1

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.norm(mat1);
mat1.delete();
console.log("dst::" + dst);//dst::16.881943016134134
```

**norm2()**

Float dst = cv.norm(src1, src2)

src1		First input mat

src2 	Second input mat

dst		Norm of src1 and src2

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[9,10,11,12,13,14,15,16,17]);
let dst2 = cv.norm2(mat1, mat2);
mat1.delete(), mat2.delete();
console.log("dst2::" + dst2);//dst2::24
```

**diag()**

Cv.Mat dst = cv.diag(src1, d = 0)

src1		First input mat

d		Index of the diagonal

dst		Output mat that has the same data of src1, but the row is equal to input rows

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.diag(mat1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,5,9:::3:::1
```

**vconcat()**

void cv.vconcat(src1, src2, dst)

src1		First input mat

src2		Second input mat has the same cols as the first input mat

dst		Output mat that has the same number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.vconcat(mat1, mat1, dst);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9:::6:::3
```

**hconcat()**

void cv.hconcat(src1, src2, dst)

src1		First input mat

src2		Second input mat has the same rows as the first input mat

dst		Output mat that has the same number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.hconcat(mat1, mat1, dst);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,1,2,3,4,5,6,4,5,6,7,8,9,7,8,9:::3:::6
```

**row()**

Cv.Mat dst = cv.row(src1, row)

src1		First input mat

row		Index of the rows

dst		Output mat that has one row

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.row(mat1, 2);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::7,8,9:::1:::3
```

**col()**

Cv.Mat dst = cv.col(src1, col)

src1		First input mat

col		Index of the cols

dst		Output mat that has one col

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.col(mat1, 2);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::3,6,9:::3:::1
```

**replaceMatOnRect()**

void cv.replaceMatOnRect(src1, src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
cv.replaceMatOnRect(mat1, rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**replaceMatOnRow()**

void cv.replaceMatOnRow(src1, arr, row)

src1		First input mat will be changed as output

arr		Second input Array as row array

row		row input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
cv.replaceMatOnRow(mat1, [11,12,13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,11,12,13,7,8,9:::3:::3
```

**replaceMatOnCol()**

void cv.replaceMatOnCol(src1, arr, col)

src1		First input mat will be changed as output

arr		Second input Array as row array

col		col input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
cv.replaceMatOnCol(mat1, [11,12,13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**replaceMatOnPoint()**

void cv.replaceMatOnPoint(src1, constant, point)

src1			First input mat will be changed as output

constant	Second input constant tp replace at the point

point		Point location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
cv.replaceMatOnPoint(mat1, 30, {x:1,y:1});
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**addOnCol()**

void cv.addOnCol(src1, constant, col)

src1			First input mat will be changed as output

constant	Second input constant tp replace at the point

col			Col location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
cv.addOnCol(mat1, 30, 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**rectAdd()**

void cv.rectAdd(src1, src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to add location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
cv.rectAdd(mat1, rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**rectSubtract()**

void cv.rectSubtract(src1, src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to subtract location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
cv.rectSubtract(mat1, rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**MDS()**

{m:Float, d:Array, s:Float} dst = cv.col(src1)

src1		First input mat

dst		Output with {mean, dev, stddev}

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.MDS(mat1);
mat1.delete();
console.log("dst::" + dst.m + ":::" + dst.d + ":::" + dst.s);
//dst::5:::16,9,4,1,0,1,4,9,16:::2.581988897471611
```

**roi()**

Cv.Mat dst = cv.roi(src1, rect)

src1		First input mat

rect		a rect

dst		Output mat that has the same size and number of channels as the input rect

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2)
let dst = cv.roi(mat1, rect1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::5,6,8,9:::2:::2
```

**svd()**

{u:cv.Mat, w:cv.Mat, vt:cv.Mat} dst = cv.svd(src1)

src1		First input mat

dst		Output with {u, w, vt}

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let s = cv.svd(mat1);
mat1.delete();
console.log("sssss::" + s.u.data32F + ":::" + s.w.data32F + "::::" + s.vt.data32F);
//sssss::-0.2690670727222803,-0.6798212121523656,-0.6822360514399335,0.9620092303255996,-0.15566952916310073,-0.22428829318197974,-0.04627257443681115,0.7166659732384585,-0.6958798255856847:::817.7596679296927,2.4749744909160456,0.002964523081211532::::0.6822778524193859,-0.6671413517114333,-0.29903068226292867,0.22871202334807922,-0.19371852220929917,0.9540251278289649,0.6943973952097016,0.7193021277527875,-0.020413391102276603
```

**RodriguesFromArray()**

cv.Mat dst = cv.RodriguesFromArray(arr1)

arr1		First input array

dst		the mat rodrigues from the input array

```javascript
let arr1 = [1,2,3,4,5,6,7,8,9];
let dst = cv.RodriguesFromArray(arr1);
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::-0.694920539855957,0.7135210037231445,0.08929285407066345,-0.19200697541236877,-0.3037850260734558,0.9331923723220825,0.6929781436920166,0.6313496828079224,0.34810739755630493:::3:::3
```

**RodriguesFromMat()**

[x, y, z] dst = cv.RodriguesFromMat(src1)

src1		First input mat

dst		the mat rodrigues from the input array

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.RodriguesFromMat(mat1);
console.log("dst::" + dst);
//dst::1.1046628653680794,1.738419705279746,2.372176486533247
```

**dftSplit()**

{r:realMat, i:imagMat} dst = cv.dftSplit(src1)

src1		First input mat

dst		the mat rodrigues from the input array

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = cv.dftSplit(mat1);
console.log("dst::" + dst.r.data32F + ":::" + dst.i.data32F);
//dst::1,3,0,4,6,0,0,8,0:::0,3,0,7,9,0,0,9,0
```

**mulSpectrums()**

cv.Mat dst = cv.dftSplit(src1, src2, conjB = false)

src1		First input mat

src2		Second input mat

conjB	Default is false

dst		Result of mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[9,10,11,12,13,14,15,16,17]);
let dst = cv.mulSpectrums(mat1, mat2, true);
mat1.delete(), mat2.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
```

## 

### Others

**default constructor**

```javascript
let mat = new cv.Mat();
let mat = new cv.Mat(size, type);
let mat = new cv.Mat(rows, cols, type);
let mat = new cv.Mat(rows, cols, type, new cv.Scalar());
let mat = cv.matFromArray(rows, cols, type, array);

let ctx = canvas.getContext("2d");
let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
let mat = cv.matFromImageData(imgData);

let mat = cv.Mat.zeros(rows, cols, type);
let mat = cv.Mat.ones(rows, cols, type);
let mat = cv.Mat.eye(rows, cols, type);
```

**copy Mat**

```javascript
let dst = src.clone();
src.copyTo(dst, mask);
```

**convert type**

```javascript
src.convertTo(m, rtype, alpha = 1, beta = 0);
```

**MatVector**

```javascript
let mat = new cv.Mat();
let matVec = new cv.MatVector();
matVec.push_back(mat);
let cnt = matVec.get(0);
mat.delete(); matVec.delete(); cnt.delete();
```

## To Do List

- **Performance**, up speed performance.
- **Methods** complete all the opencv functions.

## License

OpenCVJS is released under the MIT license. See LICENSE for details.

