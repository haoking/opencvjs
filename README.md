# opencvjs
Complete opencvjs for single channel.(With the lastest OpenCV 4.0.0+)

The official opencv.js stoped update. Moreover, it still has many errors from the last version.

This project is inherited from official opencv.js.

Which means all of the methods in opencv.js works here, also, fix most of the errors, especial for the single channel. As most of the project is using the gray image and cv.CV_32FC1.

Moreover, the version of the full channel and the full data type will come after the first release.

------

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

