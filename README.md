# opencvjs
![OpenCV 4.0.0+](https://img.shields.io/badge/OpenCV-4.0.0%2B-green.svg)

Complete opencvjs.(With the lastest OpenCV 4.0.0+)

The official opencv.js stoped update. Moreover, it still has many errors from the last offical version.

This project is inherited from official opencv.js.

Which means all of the methods in opencv.js works here, also, fix most of the errors.

But much more performance improved.

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

cv.Mat dst = src1.addConstant(constant)

( dst = src1 + constant )

src1			First input mat

constant	Constant added to each element.

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.addConstant(10);
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

cv.Mat dst = src1.constantSubtract(constant)

( dst = constant - src1 )

constant	Constant subtract each element.

src1			First input mat

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.constantSubtract(10);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::9,8,7,6,5,4,3,2,1
```

**mmul()**

cv.Mat dst = src1.mul(src2)

( dst = src1 * src2 )

src1		First input mat

src2		Second input mat

dst		Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.mmul(mat2);
mat1.delete(), mat2.delete();
console.log("dst::" + dst.data32F);//dst::30,36,42,66,81,96,102,126,150
```

**mul()**

cv.Mat dst = src1.mul(src2, scale)

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

cv.Mat dst = src1.mulConstant(constant)

( dst = src1 * constant )

src1			First input mat

constant	Constant added to each element.

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.mulConstant(10);
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

cv.Mat dst = src1.constantDivide(constant)

( dst = constant / src1 )

constant	Constant subtract each element.

src1			First input mat

dst			Output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.constantDivide(10);
mat1.delete();
console.log("dst::" + dst.data32F);
//dst::10,5,3.3333332538604736,2.5,2,1.6666666269302368,1.4285714626312256,1.25,1.1111111640930176
```

**reshape()**

Cv.Mat dst = src1.reshape(rows)

src1		First input mat

rows	Reshape to rows

dst		Output mat that has the same data of src1, but the row is equal to input rows

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.reshape(1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,4,5,6,7,8,9:::1:::9
dst.delete();//Don't forget to delete cv.Mat when you don't want to use it any more.
```

**sum()**

Float dst = src1.sum()

src1		First input mat

dst		Sum of src1 data

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let sum = mat1.sum();
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

**Diag()**

cv.Mat dst = src1.diag(d = 0)

src1		First input mat

d		Index of the diagonal

dst		Output mat that has the same data of src1, but the row is equal to input rows

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.Diag();
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,5,9:::3:::1
```

**vconcat()**

cv.Mat dst = src1.vconcat(src2)

src1		First input mat

src2		Second input mat has the same cols as the first input mat

dst		Output mat that has the same number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.vconcat(mat1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9:::6:::3
```

**hconcat()**

cv.Mat dst = src1.hconcat(src2)

src1		First input mat

src2		Second input mat has the same rows as the first input mat

dst		Output mat that has the same number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.hconcat(mat1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::1,2,3,1,2,3,4,5,6,4,5,6,7,8,9,7,8,9:::3:::6
```

**row()**

cv.Mat dst = src1.row(row)

src1		First input mat

row		Index of the rows

dst		Output mat that has one row

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.row(2);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::7,8,9:::1:::3
```

**col()**

cv.Mat dst = src1.col(col)

src1		First input mat

col		Index of the cols

dst		Output mat that has one col

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.col(2);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::3,6,9:::3:::1
```

**replaceMatOnRect()**

void src1.replaceMatOnRect(src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
mat1.replaceMatOnRect(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**replaceMatOnRow()**

void src1.replaceMatOnRow(arr, row)

src1		First input mat will be changed as output

arr		Second input Array as row array

row		row input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
mat1.replaceMatOnRow([11,12,13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,11,12,13,7,8,9:::3:::3
```

**replaceMatOnCol()**

void src1.replaceMatOnCol(arr, col)

src1		First input mat will be changed as output

arr		Second input Array as row array

col		col input to replace

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
mat1.replaceMatOnCol([11,12,13], 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**replaceMatOnPoint()**

void src1.replaceMatOnPoint(constant, point)

src1			First input mat will be changed as output

constant	Second input constant tp replace at the point

point		Point location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
mat1.replaceMatOnPoint(30, {x:1,y:1});
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**addOnCol()**

void src1.addOnCol(constant, col)

src1			First input mat will be changed as output

constant	Second input constant tp replace at the point

col			Col location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
mat1.addOnCol(30, 1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,11,3,4,12,6,7,13,9:::3:::3
```

**rectAdd()**

void src1.rectAdd(src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to add location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
mat1.rectAdd(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**rectSubtract()**

void src1.rectSubtract(src2, rect)

src1		First input mat will be changed as output

src2		Second input mat as rect mat

rect		rect input to subtract location

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2);
let rectmat = cv.matFromArray(2,2,cv.CV_32FC1,[11,12,13,14]);
mat1.rectSubtract(rectmat, rect1);
console.log("mat1::" + mat1.data32F + ":::" + mat1.rows + ":::" + mat1.cols);
//mat1::1,2,3,4,11,12,7,13,14:::3:::3
```

**mds()**

{m:Float, d:Array, s:Float} dst = src1.mds()

src1		First input mat

dst		Output with {mean, dev, stddev}

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.mds();
mat1.delete();
console.log("dst::" + dst.m + ":::" + dst.d + ":::" + dst.s);
//dst::5:::16,9,4,1,0,1,4,9,16:::2.581988897471611
```

**roi()**

Cv.Mat dst = src1.roi(rect)

src1		First input mat

rect		a rect

dst		Output mat that has the same size and number of channels as the input rect

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let rect1 = new cv.Rect(1, 1, 2, 2)
let dst = mat1.roi(rect1);
mat1.delete();
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols);
//dst::5,6,8,9:::2:::2
```

**svd()**

{u:cv.Mat, w:cv.Mat, vt:cv.Mat} dst = src1.svd()

src1		First input mat

dst		Output with {u, w, vt}

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let s = mat1.svd();
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

[x, y, z] dst = src1.RodriguesFromMat()

src1		First input mat

dst		the mat rodrigues from the input array

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.RodriguesFromMat();
console.log("dst::" + dst);
//dst::1.1046628653680794,1.738419705279746,2.372176486533247
```

**dftSplit()**

{r:realMat, i:imagMat} dst = src1.dftSplit()

src1		First input mat

dst		the mat rodrigues from the input array

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = mat1.dftSplit();
console.log("dst::" + dst.r.data32F + ":::" + dst.i.data32F);
//dst::1,3,0,4,6,0,0,8,0:::0,3,0,7,9,0,0,9,0
```

**mulSpectrums()**

cv.Mat dst = cv.mulSpectrums(src1, src2, conjB = false)

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
//dst::9,8.96831017167883e-44,66,153,4.624284932271896e-44,237,NaN,1.2534558711446916e-39,NaN:::3:::3
```

**mulSpectrums2Channel()**

cv.Mat dst = cv.mulSpectrums2Channel(src1, src2, conjB = false)

src1		First input mat

src2		Second input mat

conjB	Default is false

dst		Result of mat

```javascript
let mat1_2channels = cv.matFromArray(3,3,cv.CV_32FC2,[1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9]);
let mat2_2channels = cv.matFromArray(3,3,cv.CV_32FC2,[9,10,11,12,13,14,15,16,17,9,10,11,12,13,14,15,16,17]);
let dst = cv.mulSpectrums2Channel(mat1_2channels, mat2_2channels, true);
console.log("dst::" + dst.data32F + ":::" + dst.rows + ":::" + dst.cols + ":::" + dst.channels());
//dst::29,8.96831017167883e-44,81,233,4.624284932271896e-44,162,NaN,1.2534558711446916e-39,NaN:::3:::3:::1
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

**data**

```javascript
[Data Properties]	[C++ Type]	[JavaScript Typed Array]	[Mat Type]
data				uchar		Uint8Array					CV_8U
data8S				char		Int8Array					CV_8S
data16U				ushort		Uint16Array					CV_16U
data16S				short		Int16Array					CV_16S
data32S				int			Int32Array					CV_32S
data32F				float		Float32Array				CV_32F
data64F				double		Float64Array				CV_64F

// row = 3, col = 4, channels = 4
let R = src.data[row * src.cols * src.channels() + col * src.channels()];
let G = src.data[row * src.cols * src.channels() + col * src.channels() + 1];
let B = src.data[row * src.cols * src.channels() + col * src.channels() + 2];
let A = src.data[row * src.cols * src.channels() + col * src.channels() + 3];
```

**at**

```javascript
[Mat Type]		[At Manipulation]
CV_8U			ucharAt
CV_8S			charAt
CV_16U			ushortAt
CV_16S			shortAt
CV_32S			intAt
CV_32F			floatAt
CV_64F			doubleAt

//row = 3, col = 4, channels = 4
let R = src.ucharAt(row, col * src.channels());
let G = src.ucharAt(row, col * src.channels() + 1);
let B = src.ucharAt(row, col * src.channels() + 2);
let A = src.ucharAt(row, col * src.channels() + 3);
```

**ptr**

```javascript
[Mat Type]		[Ptr Manipulation]		[JavaScript Typed Array]
CV_8U			ucharPtr				Uint8Array
CV_8S			charPtr					Int8Array
CV_16U			ushortPtr				Uint16Array
CV_16S			shortPtr				Int16Array
CV_32S			intPtr					Int32Array
CV_32F			floatPtr				Float32Array
CV_64F			doublePtr				Float64Array

//row = 3, col = 4, channels = 4
let pixel = src.ucharPtr(row, col);
let R = pixel[0];
let G = pixel[1];
let B = pixel[2];
let A = pixel[3];
```

**Bitwise Operations**

```javascript
cv.bitwise_not();
cv.bitwise_and();
cv.bitwise_or();
cv.bitwise_xor();
```

**Point**

```javascript
let point = new cv.Point(x, y);
let point = {x: x, y: y};
```

**Scalar**

```javascript
let scalar = new cv.Scalar(R, G, B, Alpha);
let scalar = [R, G, B, Alpha];
```

**Size**

```javascript
let size = new cv.Size(width, height);
let size = {width : width, height : height};
```

**Circle**

```javascript
let circle = new cv.Circle(center, radius);
let circle = {center : center, radius : radius};
```

**Rect**

```javascript
let rect = new cv.Rect(x, y, width, height);
let rect = {x : x, y : y, width : width, height : height};
```

**RotatedRect**

```javascript
let rotatedRect = new cv.RotatedRect(center, size, angle);
let rotatedRect = {center : center, size : size, angle : angle};

let vertices = cv.RotatedRect.points(rotatedRect);
let point1 = vertices[0];
let point2 = vertices[1];
let point3 = vertices[2];
let point4 = vertices[3];

let boundingRect = cv.RotatedRect.boundingRect(rotatedRect);
```

**cvtColor**

```javascript
cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);
```

**inRange**

```javascript
cv.inRange(src, low, high, dst);
```

**Scaling**

```javascript
cv.resize (src, dst, dsize, fx = 0, fy = 0, interpolation = cv.INTER_LINEAR)
```

**Translation**

```javascript
cv.warpAffine (src, dst, M, dsize, flags = cv.INTER_LINEAR, borderMode = cv.BORDER_CONSTANT, borderValue = new cv.Scalar())
```

**Rotation**

```javascript
cv.getRotationMatrix2D (center, angle, scale)
```

**Affine Transformation**

```javascript
cv.getAffineTransform (src, dst)
```

**Perspective Transformation**

```javascript
let M = cv.getPerspectiveTransform(srcTri, dstTri);
cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
```

**Simple Thresholding**

```javascript
cv.threshold(src, dst, 177, 200, cv.THRESH_BINARY);
```

**Adaptive Thresholding**

```javascript
//cv.adaptiveThreshold (src, dst, maxValue, adaptiveMethod, thresholdType, blockSize, C)
cv.adaptiveThreshold(src, dst, 200, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 3, 2);
```

**2D Convolution ( Image Filtering )**

```javascript
//cv.filter2D (src, dst, ddepth, kernel, anchor = new cv.Point(-1, -1), delta = 0, borderType = cv.BORDER_DEFAULT)
cv.filter2D(src, dst, cv.CV_8U, M, anchor, 0, cv.BORDER_DEFAULT);
```

**Image Blurring (Image Smoothing)**

```javascript
//cv.blur (src, dst, ksize, anchor = new cv.Point(-1, -1), borderType = cv.BORDER_DEFAULT)
cv.blur(src, dst, ksize, anchor, cv.BORDER_DEFAULT);

//cv.boxFilter (src, dst, ddepth, ksize, anchor = new cv.Point(-1, -1), normalize = true, borderType = cv.BORDER_DEFAULT)
cv.boxFilter(src, dst, -1, ksize, anchor, true, cv.BORDER_DEFAULT)

//cv.GaussianBlur (src, dst, ksize, sigmaX, sigmaY = 0, borderType = cv.BORDER_DEFAULT)
cv.GaussianBlur(src, dst, ksize, 0, 0, cv.BORDER_DEFAULT);

//cv.medianBlur (src, dst, ksize)
cv.medianBlur(src, dst, 5);

//cv.bilateralFilter (src, dst, d, sigmaColor, sigmaSpace, borderType = cv.BORDER_DEFAULT)
cv.bilateralFilter(src, dst, 9, 75, 75, cv.BORDER_DEFAULT);
```

**Erosion**

```javascript
//cv.erode (src, dst, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.erode(src, dst, M, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
```

**Dilation**

```javascript
//cv.dilate (src, dst, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.dilate(src, dst, M, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
```

**Opening**

```javascript
//cv.morphologyEx (src, dst, op, kernel, anchor = new cv.Point(-1, -1), iterations = 1, borderType = cv.BORDER_CONSTANT, borderValue = cv.morphologyDefaultBorderValue())
cv.morphologyEx(src, dst, cv.MORPH_OPEN, M, anchor, 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
```

**Closing**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_CLOSE, M);
```

**Morphological Gradient**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_GRADIENT, M);
```

**Top Hat**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_TOPHAT, M);
```

**Black Hat**

```javascript
cv.morphologyEx(src, dst, cv.MORPH_BLACKHAT, M);
```

**Structuring Element**

```javascript
//cv.getStructuringElement (shape, ksize, anchor = new cv.Point(-1, -1))
M = cv.getStructuringElement(cv.MORPH_CROSS, ksize);
cv.morphologyEx(src, dst, cv.MORPH_GRADIENT, M);
```

**Sobel and Scharr Derivatives**

```javascript
//cv.Sobel (src, dst, ddepth, dx, dy, ksize = 3, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Sobel(src, dstx, cv.CV_8U, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);

//cv.Scharr (src, dst, ddepth, dx, dy, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Scharr(src, dstx, cv.CV_8U, 1, 0, 1, 0, cv.BORDER_DEFAULT);
```

**Laplacian Derivatives**

```javascript
//cv.Laplacian (src, dst, ddepth, ksize = 1, scale = 1, delta = 0, borderType = cv.BORDER_DEFAULT)
cv.Laplacian(src, dst, cv.CV_8U, 1, 1, 0, cv.BORDER_DEFAULT);
```

**Image AbsSobel**

```javascript
cv.Sobel(src, dstx, cv.CV_8U, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
cv.Sobel(src, absDstx, cv.CV_64F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
cv.convertScaleAbs(absDstx, absDstx, 1, 0);
```

**draw the contours**

```javascript
//cv.findContours (image, contours, hierarchy, mode, method, offset = new cv.Point(0, 0))
cv.findContours(src, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

//cv.drawContours (image, contours, contourIdx, color, thickness = 1, lineType = cv.LINE_8, hierarchy = new cv.Mat(), maxLevel = INT_MAX, offset = new cv.Point(0, 0))
cv.drawContours(dst, contours, i, color, 1, cv.LINE_8, hierarchy, 100);
```

**Moments**

```javascript
//cv.moments (array, binaryImage = false)
let Moments = cv.moments(cnt, false);
```

**Contour Area**

```javascript
//cv.contourArea (contour, oriented = false)
let area = cv.contourArea(cnt, false);
```

**Contour Perimeter**

```javascript
//cv.arcLength (curve, closed)
let perimeter = cv.arcLength(cnt, true);
```

**Contour Approximation**

```javascript
//cv.approxPolyDP (curve, approxCurve, epsilon, closed)
cv.approxPolyDP(cnt, tmp, 3, true);
```

**Convex Hull**

```javascript
//cv.convexHull (points, hull, clockwise = false, returnPoints = true)
cv.convexHull(cnt, tmp, false, true);
```

**Checking Convexity**

```javascript
cv.isContourConvex(cnt);
```

**Straight Bounding Rectangle**

```javascript
//cv.boundingRect (points)
let rect = cv.boundingRect(cnt);
```

**Rotated Rectangle**

```javascript
//cv.minAreaRect (points)
let rotatedRect = cv.minAreaRect(cnt);
```

**Minimum Enclosing Circle**

```javascript
//cv.minEnclosingCircle (points)
let circle = cv.minEnclosingCircle(cnt);

//cv.circle (img, center, radius, color, thickness = 1, lineType = cv.LINE_8, shift = 0)
cv.circle(dst, circle.center, circle.radius, circleColor);
```

**Fitting an Ellipse**

```javascript
//cv.fitEllipse (points)
let rotatedRect = cv.fitEllipse(cnt);

//cv.ellipse1 (img, box, color, thickness = 1, lineType = cv.LINE_8)
cv.ellipse1(dst, rotatedRect, ellipseColor, 1, cv.LINE_8);
```

**Fitting a Line**

```javascript
//cv.fitLine (points, line, distType, param, reps, aeps)
cv.fitLine(cnt, line, cv.DIST_L2, 0, 0.01, 0.01);

//cv.line (img, pt1, pt2, color, thickness = 1, lineType = cv.LINE_8, shift = 0)
cv.line(dst, point1, point2, lineColor, 2, cv.LINE_AA, 0);
```

**Aspect Ratio**

```javascript
let rect = cv.boundingRect(cnt);
let aspectRatio = rect.width / rect.height;
```

**Extent**

```javascript
let area = cv.contourArea(cnt, false);
let rect = cv.boundingRect(cnt));
let rectArea = rect.width * rect.height;
let extent = area / rectArea;
```

**Solidity**

```javascript
let area = cv.contourArea(cnt, false);
cv.convexHull(cnt, hull, false, true);
let hullArea = cv.contourArea(hull, false);
let solidity = area / hullArea;
```

**Equivalent Diameter**

```javascript
let area = cv.contourArea(cnt, false);
let equiDiameter = Math.sqrt(4 * area / Math.PI);
```

**Orientation**

```javascript
let rotatedRect = cv.fitEllipse(cnt);
let angle = rotatedRect.angle;
```

**Mask and Pixel Points**

```javascript
//cv.transpose (src, dst)
cv.transpose(src, dst);
```

**Maximum Value, Minimum Value and their locations**

```javascript
//cv.minMaxLoc(src, mask)
let result = cv.minMaxLoc(src, mask);
let minVal = result.minVal;
let maxVal = result.maxVal;
let minLoc = result.minLoc;
let maxLoc = result.maxLoc;
```

**Mean Color or Mean Intensity**

```javascript
cv.mean (src, mask)
```

**Convexity Defects**

```javascript
//cv.convexityDefects (contour, convexhull, convexityDefect)
cv.convexityDefects(cnt, hull, defect);
```

**Point Polygon Test**

```javascript
//cv.pointPolygonTest (contour, pt, measureDist)
let dist = cv.pointPolygonTest(cnt, new cv.Point(50, 50), true);
```

**Match Shapes**

```javascript
//cv.matchShapes (contour1, contour2, method, parameter)
let result = cv.matchShapes(contours.get(contourID0), contours.get(contourID1), 1, 0);
```

**Find Histogram**

```javascript
//cv.calcHist (image, channels, mask, hist, histSize, ranges, accumulate = false)
cv.calcHist(srcVec, channels, mask, hist, histSize, ranges, accumulate);
```

**Histograms Equalization**

```javascript
cv.equalizeHist (src, dst)
```

**CLAHE (Contrast Limited Adaptive Histogram Equalization)**

```javascript
//cv.CLAHE (clipLimit = 40, tileGridSize = new cv.Size(8, 8))
let clahe = new cv.CLAHE(40, tileGridSize);
```

**Backprojection**

```javascript
//cv.calcBackProject (images, channels, hist, dst, ranges, scale)
cv.calcBackProject(dstVec, channels, hist, backproj, ranges, 1);

//cv.normalize (src, dst, alpha = 1, beta = 0, norm_type = cv.NORM_L2, dtype = -1, mask = new cv.Mat())
cv.normalize(hist, hist, 0, 255, cv.NORM_MINMAX, -1, none);
```

**Fourier Transform**

```javascript
//cv.dft (src, dst, flags = 0, nonzeroRows = 0)
cv.dft(complexI, complexI);

//cv.getOptimalDFTSize (vecsize)
let optimalRows = cv.getOptimalDFTSize(src.rows);

//cv.copyMakeBorder (src, dst, top, bottom, left, right, borderType, value = new cv.Scalar())
cv.copyMakeBorder(src, padded, 0, optimalRows - src.rows, 0, optimalCols - src.cols, cv.BORDER_CONSTANT, s0);

//cv.magnitude (x, y, magnitude)
cv.magnitude(planes.get(0), planes.get(1), planes.get(0));

//cv.split (m, mv)
cv.split(complexI, planes);

//cv.merge (mv, dst)
cv.merge(planes, complexI);
```

**Template Matching**

```javascript
//cv.matchTemplate (image, templ, result, method, mask = new cv.Mat())
cv.matchTemplate(src, templ, dst, cv.TM_CCOEFF, mask);
```

**Hough Transform**

```javascript
//cv.HoughLines (image, lines, rho, theta, threshold, srn = 0, stn = 0, min_theta = 0, max_theta = Math.PI)
cv.HoughLines(src, lines, 1, Math.PI / 180, 30, 0, 0, 0, Math.PI);
```

**Probabilistic Hough Transform**

```javascript
//cv.HoughLinesP (image, lines, rho, theta, threshold, minLineLength = 0, maxLineGap = 0)
cv.HoughLinesP(src, lines, 1, Math.PI / 180, 2, 0, 0);
```

**Hough Circle Transform**

```javascript
//cv.HoughCircles (image, circles, method, dp, minDist, param1 = 100, param2 = 100, minRadius = 0, maxRadius = 0)
cv.HoughCircles(src, circles, cv.HOUGH_GRADIENT, 1, 45, 75, 40, 0, 0);
```

**Threshold**

```javascript
cv.threshold(gray, gray, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
```

**Distance Transform**

```javascript
//cv.distanceTransform (src, dst, distanceType, maskSize, labelType = cv.CV_32F)
cv.distanceTransform(opening, distTrans, cv.DIST_L2, 5);
```

**mage Watershed**

```javascript
//cv.connectedComponents (image, labels, connectivity = 8, ltype = cv.CV_32S)
cv.connectedComponents(coinsFg, markers);

//cv.watershed (image, markers)
cv.watershed(src, markers);
```

**Foreground Extraction**

```javascript
//cv.grabCut (image, mask, rect, bgdModel, fgdModel, iterCount, mode = cv.GC_EVAL)
cv.grabCut(src, mask, rect, bgdModel, fgdModel, 1, cv.GC_INIT_WITH_RECT);
```

**Meanshift**

```javascript
//cv.meanShift (probImage, window, criteria)
[, trackWindow] = cv.meanShift(dst, trackWindow, termCrit);
```

**Camshift**

```javascript
//cv.CamShift (probImage, window, criteria)
[trackBox, trackWindow] = cv.CamShift(dst, trackWindow, termCrit);
```

**Lucas-Kanade Optical Flow**

```javascript
//cv.calcOpticalFlowPyrLK (prevImg, nextImg, prevPts, nextPts, status, err, winSize = new cv.Size(21, 21), maxLevel = 3, criteria = new cv.TermCriteria(cv.TermCriteria_COUNT+ cv.TermCriteria_EPS, 30, 0.01), flags = 0, minEigThreshold = 1e-4)
let criteria = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 10, 0.03);
cv.calcOpticalFlowPyrLK(oldGray, frameGray, p0, p1, st, err, winSize, maxLevel, criteria);

```

**Dense Optical Flow**

```javascript
//cv.calcOpticalFlowFarneback (prev, next, flow, pyrScale, levels, winsize, iterations, polyN, polySigma, flags)
cv.calcOpticalFlowFarneback(prvs, next, flow, 0.5, 3, 15, 3, 5, 1.2, 0);
```

**BackgroundSubtractorMOG2**

```javascript
//cv.BackgroundSubtractorMOG2 (history = 500, varThreshold = 16, detectShadows = true)
let fgbg = new cv.BackgroundSubtractorMOG2(500, 16, true);

//cv.apply (image, fgmask, learningRate = -1)
fgbg.apply(frame, fgmask);
```

**Haar-cascade Detection**

```javascript
//detectMultiScale (image, objects, scaleFactor = 1.1, minNeighbors = 3, flags = 0, minSize = new cv.Size(0, 0), maxSize = new cv.Size(0, 0))
let faceCascade = new cv.CascadeClassifier();
faceCascade.load('haarcascade_frontalface_default.xml');
faceCascade.detectMultiScale(gray, faces, 1.1, 3, 0, msize, msize);
```

**image && video**

```javascript
cv.imread();
cv.imshow();
cv.VideoCapture();
```

**other**

```javascript
cv.rectangle();
cv.Canny();
cv.goodFeaturesToTrack();
cv.cartToPolar();
cv.randu();
new cv.ORB();
```

## To Do List

- **Performance**, up speed performance.
- **Methods** complete all the opencv functions.

## License

OpenCVJS is released under the MIT license. See LICENSE for details.

