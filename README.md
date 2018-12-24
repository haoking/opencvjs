# opencvjs
Complete opencvjs for single channel.(With the lastest OpenCV 4.0.0+)

add()

void cv.add(src1, src2, dst) 

( dst = src1 + src2 )

src1		first input mat

src2		second input mat

dst		output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.add(mat1, mat2, dst);
mat1.delete(), mat2.delete(); //Don't forget to delete cv.Mat when you don't want to use it any more.
console.log("dst::" + dst.data32F);//dst::2,4,6,8,10,12,14,16,18
```

addConstant()

void cv.addConstant(src1, constant, dst)

( dst = src1 + constant )

src1			first input mat

constant	constant added to each element.

dst			output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.addConstant(mat1, 10, dst);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::11,12,13,14,15,16,17,18,19
```
subtract()

void cv.subtract(src1, src2, dst)

( dst = src1 - src2 )

src1		first input mat

src2		second input mat

dst		output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let mat2 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.subtract(mat1, mat2, dst);
mat1.delete(), mat2.delete(); //Don't forget to delete cv.Mat when you don't want to use it any more.
console.log("dst::" + dst.data32F);//dst::0,0,0,0,0,0,0,0,0
```

constantSubtract()

void cv.constantSubtract(constant, src1, dst)

( dst = constant - src1 )

constant	constant subtract each element.

src1			first input mat

dst			output mat that has the same size and number of channels as the input mat

```javascript
let mat1 = cv.matFromArray(3,3,cv.CV_32FC1,[1,2,3,4,5,6,7,8,9]);
let dst = new cv.Mat();
cv.constantSubtract(10, mat1, dst);
mat1.delete();
console.log("dst::" + dst.data32F);//dst::9,8,7,6,5,4,3,2,1
```

