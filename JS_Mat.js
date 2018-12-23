
class JSMat {

    //cv.Mat()
    constructor(mat) {

        this.mat = mat;
    }

    delete () {
        this.mat.delete();
    }

    //mat + mat
    static add(mat1, mat2) { return new JSMat(CV.add(mat1.mat, mat2.mat)); }
    //mat + int
    static addConstant(mat1, constant) { return new JSMat(CV.addConstant(mat1.mat, constant)); }
    //mat - mat
    static subtract(mat1, mat2) { return new JSMat(CV.subtract(mat1.mat, mat2.mat)); }
    //int - mat
    static constantSubtract(constant, mat1) { return new JSMat(CV.constantSubtract(constant, mat1.mat)); }
    //mat * mat
    static mul(mat1, mat2) { return new JSMat(CV.mul(mat1.mat, mat2.mat)); }
    //mat * int
    static mulConstant(mat1, constant) { return new JSMat(CV.mulConstant(mat1.mat, constant)); }
    //mat / mat
    static divide(mat1, mat2) { return new JSMat(CV.divide(mat1.mat, mat2.mat)); }
    //int / mat
    static constantDivide(constant, mat1) { return new JSMat(CV.constantDivide(constant, mat1.mat)); }
    //sum
    sum() { return CV.sum(this.mat); }

    t() { return new JSMat(this.mat.t()); }

    static norm(mat1, mat2 = new JSMat(null)) { return CV.norm(mat1.mat, mat2.mat); }

    //reshape
    reshape(rows) { return new JSMat(CV.reshape(this.mat, rows)); }



    //replaceMatFromRect
    replaceMatFromRect(mat1, rect) {
        for (var i = 0; i < rect.height; ++i) {
            for (var j = 0; j <  rect.width; ++j) {
                this.mat.floatPtr(i+rect.y, j+rect.x)[0] = mat1.mat.floatPtr(i, j)[0];
            }
        }
    }



    //replaceMatRow
    replaceMatFromRow(arr, row) {
        this.mat.floatPtr(row).forEach(function(part, index, theArray) {
            theArray[index] = arr[index];
        });
    }

    //replaceMatCol
    replaceMatFromCol(arr, col) {
        for (var i = 0; i < this.mat.rows; i++)
        {
            this.mat.floatPtr(i, col)[0] = arr[i];
        }
    }

    //replaceDataFromPoint
    replaceDataFromPoint(number, point) {
        this.mat.floatPtr(point.x, point.y)[0] = number;
    }

    diag() {
        return new JSMat(CV.diag(this.mat));
    }

    constantAddMatOnCol(constant, col) {
        for (var i = 0; i < this.mat.rows; i++)
        {
            this.mat.floatPtr(i, col)[0] += constant;
        }
    }


    ///////////////////Temp//////////////////

    rectAddRect(rect1, mat2) {
        let height = rect1.height;
        let width = rect1.width;
        // let roiArray = null;
        for (var i = 0; i < height; ++i) {
            for (var j = 0; j < width; ++j) {
                this.mat.floatPtr(rect1.y+i, rect1.x+j)[0] += mat2.mat.floatPtr(i, j)[0];
            }
        }
    }

    rectSubtractRect(rect1, mat2) {
        let height = rect1.height;
        let width = rect1.width;
        // let roiArray = null;
        for (var i = 0; i < height; ++i) {
            for (var j = 0; j < width; ++j) {
                this.mat.floatPtr(rect1.y+i, rect1.x+j)[0] -= mat2.mat.floatPtr(i, j)[0];
            }
        }
    }




    ///////////////////Temp//////////////////


}


class CV {
    constructor() {

    }

    //mat + mat
    static add(mat1, mat2, dst) {
        cv.addWeighted(mat1, 1, mat2, 1, 0, dst);
    }

    //mat + int
    static addConstant(mat1, constant, dst) {
        cv.addWeighted(mat1, 1, mat1, 0, constant, dst);
    }

    //mat - mat
    static subtract(mat1, mat2, dst) {
        cv.subtract(mat1, mat2, dst);
    }

    //int - mat
    static constantSubtract(constant, mat1, dst) {
        cv.addWeighted(mat1, -1, mat1, 0, constant, dst);
    }

    //mat * mat
    static mul(mat1, mat2, dst) {
        let temp = new cv.Mat();
        cv.gemm(mat1,mat2,1,temp,0,dst);
        temp.delete();
    }

    //mat * int
    static mulConstant(mat1, constant, dst) {
        cv.addWeighted(mat1, constant, mat1, 0, 0, dst);
    }

    //mat / mat
    static divide(mat1, mat2, dst) {
        cv.divide(mat1, mat2, dst);
    }

    //int / mat
    static constantDivide(constant, mat1, dst) {
        let constantMat = new cv.Mat(mat1.rows, mat1.cols, cv.CV_32FC1, new cv.Scalar(constant));
        cv.divide(constantMat, mat1, dst);
        constantMat.delete();
    }
//
    static reshape(mat1, rows) {
        return cv.matFromArray(rows, mat1.rows * mat1.cols / rows, cv.CV_32FC1, mat1.data32F);
    }
//
    static sum(mat1) {
        return mat1.data32F.reduce((a,b)=>a+b);
    }

    static norm(mat1, mat2) {
        let sub12 = new cv.Mat();
        CV.subtract(mat1, mat2, sub12);
        let normDouble = cv.norm(sub12);
        sub12.delete();
        return normDouble;
    }

    static diag(mat1) {
        let row = mat1.rows;
        let dst = cv.Mat.zeros(row, row, cv.CV_32FC1);
        for (var i = 0; i < row; ++i)
        {
            dst.floatPtr(i,i)[0] = mat1.floatPtr(i, 0)[0];
        }
        return dst;
    }

    static vconcat(mat1, mat2, dst) {
        let input = new cv.MatVector();
        input.push_back(mat1);
        input.push_back(mat2);
        cv.vconcat(input, dst);
        input.delete();
    }

    static hconcat(mat1, mat2, dst) {
        let input = new cv.MatVector();
        input.push_back(mat1);
        input.push_back(mat2);
        cv.hconcat(input, dst);
        input.delete();
    }

    static row(number, mat1) {
        return cv.matFromArray(1, mat1.cols, cv.CV_32FC1, mat1.floatPtr(number));
    }

    static col(number, mat1) {
        let mat2 = new cv.Mat();
        let planesI = new cv.MatVector();
        planesI.push_back(mat1);
        cv.merge(planesI, mat2);
        let dst = mat2.col(number);
        cv.split(dst, planesI);
        mat2.delete();
        dst.delete();
        let res = planesI.get(0);
        planesI.delete();
        return res;
    }

    static MDS(mat1) {
        let mat1Array = mat1.data32F;
        let mat1Length = mat1Array.length;
        let mean = mat1Array.reduce(function(x,y){return x+y;})/mat1Length;
        let dev= mat1Array.map(function(x){return (x-mean)*(x-mean);});
        let stddev = Math.sqrt(dev.reduce(function(x,y){return x+y;})/mat1Length);
        return {m:mean, d:dev, s:stddev};
    }

    static ROI(mat1, rect) {
        let mat2 = new cv.Mat();
        let planesI = new cv.MatVector();
        planesI.push_back(mat1);
        cv.merge(planesI, mat2);
        let dst = mat2.roi(rect);
        cv.split(dst, planesI);
        mat2.delete();
        dst.delete();
        let res = planesI.get(0);
        planesI.delete();
        return res;
    }

    static SVD(mat1) {
        let mat1Array = [];

        for (var i = 0; i < mat1.rows; ++i)
        {
            mat1Array[i] = mat1.floatPtr(i);
        }

        let svd = numeric.svd(mat1Array);

        let svdArrayU = [].concat.apply([],svd.U);
        let svdArrayS = [].concat.apply([],svd.S);
        let svdArrayV = [].concat.apply([],svd.V);



        return {u:cv.matFromArray(svd.U.length, svd.U[0].length, cv.CV_32FC1, svdArrayU),
                w:cv.matFromArray(svd.S.length, 1, cv.CV_32FC1, svdArrayS),
                vt:cv.matFromArray(svd.V.length, svd.V[0].length, cv.CV_32FC1, svdArrayV).t()}
    }

    static RodriguesFromArray(arr) {

        let theta = Math.sqrt(arr[0]*arr[0] + arr[1]*arr[1] + arr[2]*arr[2]);

        let c = Math.cos(theta);
        let s = Math.sin(theta);
        let c1 = 1 - c;
        let itheta = theta ? 1/theta : 0;

        let r = {x:arr[0]*itheta, y:arr[1]*itheta, z:arr[2]*itheta};

        let rrt = cv.matFromArray(3, 3, cv.CV_32FC1, [r.x*r.x, r.x*r.y, r.x*r.z, r.x*r.y, r.y*r.y, r.y*r.z, r.x*r.z, r.y*r.z, r.z*r.z]);
        let r_x = cv.matFromArray(3, 3, cv.CV_32FC1, [0, -r.z, r.y, r.z, 0, -r.x, -r.y, r.x, 0]);

        let m1 =  new cv.Mat();
        CV.mulConstant(r_x, s, m1);
        let m2 = new cv.Mat();
        CV.mulConstant(rrt, c1, m2);
        let m3 = cv.Mat.eye(3,3,cv.CV_32FC1);
        let m4 = new cv.Mat();
        CV.mulConstant(m3, c, m4);
        let m5 = new cv.Mat();
        CV.add(m4, m2, m5);
        let dst = new cv.Mat();
        CV.add(m5,m1,dst);

        m1.delete();
        m2.delete();
        m3.delete();
        m4.delete();
        m5.delete();
        return dst;
    }

    static RodriguesFromMat(mat1) {

        let svd = CV.SVD(mat1);
        let R = new cv.Mat();
        CV.mul(svd.u, svd.vt, R);

        let r = {x: R.floatPtr(2, 1)[0] - R.floatPtr(1, 2)[0], y: R.floatPtr(0, 2)[0] - R.floatPtr(2, 0)[0], z: R.floatPtr(1, 0)[0] - R.floatPtr(0, 1)[0]};

        let s = Math.sqrt((r.x*r.x + r.y*r.y + r.z*r.z)*0.25);
        let c = (R.floatPtr(0, 0)[0] + R.floatPtr(1, 1)[0] + R.floatPtr(2, 2)[0] - 1)*0.5;
        c = c > 1 ? 1 : c < -1 ? -1 : c;
        let theta = Math.acos(c);

        if( s < 1e-5 )
        {
            let t = 0;
            if( c > 0 )
                r = {x:0, y:0, z:0};
            else
            {
                t = (R.floatPtr(0, 0)[0] + 1)*0.5;
                r.x = Math.sqrt(Math.max(t,0));
                t = (R.floatPtr(1, 1)[0] + 1)*0.5;
                r.y = Math.sqrt(Math.max(t,0))*(R.floatPtr(0, 1)[0] < 0 ? -1 : 1);
                t = (R.floatPtr(2, 2)[0] + 1)*0.5;
                r.z = Math.sqrt(MAX(t,0))*(R.floatPtr(0, 2)[0] < 0 ? -1 : 1);
                if( Math.abs(r.x) < Math.abs(r.y) && Math.abs(r.x) < Math.abs(r.z) && (R.floatPtr(1, 2)[0] > 0) != (r.y*r.z > 0) )
                    r.z = -r.z;
                theta /= Math.sqrt(r.x*r.x + r.y*r.y + r.z*r.z);
                r.x *= theta;
                r.y *= theta;
                r.z *= theta;
            }
        }
        else
        {
            let vth = 1/(2*s);

            vth *= theta;

            r.x *= vth;
            r.y *= vth;
            r.z *= vth;
        }

        R.delete();
        return [r.x, r.y, r.z];
    }

    // complex has 1 channels
    static dftSplit(complex) {

        let M = complex.rows;
        let N = complex.cols;

        let colOneArray = [];
        let colLastArray = [];

        let realMat = cv.Mat.zeros(M,N,cv.CV_32FC1);
        let imagMat = cv.Mat.zeros(M,N,cv.CV_32FC1);

        for (var m = 0; m <= M - 1; m++) {
            colOneArray.push(complex.floatPtr(m, 0)[0]);
            colLastArray.push(complex.floatPtr(m, N-1)[0]);
            for (var n = 1, i = 1; n <= N-2; n+=2, i++) {
                realMat.floatPtr(m, i)[0] = complex.floatPtr(m, n)[0];
                imagMat.floatPtr(m, i)[0] = complex.floatPtr(m, n+1)[0];
            }
        }

        realMat.floatPtr(0, 0)[0] = colOneArray[0];
        realMat.floatPtr(M/2, 0)[0] = colOneArray[M-1];
        realMat.floatPtr(0, N/2)[0] = colLastArray[0];
        realMat.floatPtr(M/2, N/2)[0] = colLastArray[M-1];
        for (var m = 1, i = 1; m <= M - 2; m+=2, i++) {
            realMat.floatPtr(i, 0)[0] = colOneArray[m];
            imagMat.floatPtr(i, 0)[0] = colOneArray[m+1];

            realMat.floatPtr(i, N/2)[0] = colLastArray[m];
            imagMat.floatPtr(i, N/2)[0] = colLastArray[m+1];
        }

        return [realMat, imagMat];
    }

    static mulSpectrums(singleI, singleII, conjB) {
        let planesI = CV.dftSplit(singleI);
        let realI = planesI[0];
        let imagI = planesI[1];

        let planesII = CV.dftSplit(singleII);
        let realII = planesII[0];
        let imagII = planesII[1];

        if (conjB === true) {
            CV.mulConstant(imagII, -1, imagII);
        }
        let realMulMat = new cv.Mat();
        CV.subtract(realI.mul(realII, 1), imagI.mul(imagII, 1), realMulMat);
        let imagMulMat = new cv.Mat();
        CV.add(realI.mul(imagII, 1), imagI.mul(realII, 1), imagMulMat);

        let M = realI.rows;
        let N = realI.cols;

        let centerArray = [];
        for (var m = 0; m <= M - 1; m++) {
            for (var n = 1; n <= N / 2 - 1; n++) {
                centerArray.push(realMulMat.floatPtr(m, n)[0]);
                centerArray.push(imagMulMat.floatPtr(m, n)[0]);
            }
        }
        let centerMat = cv.matFromArray(M, N - 2, cv.CV_32FC1, centerArray);

        let colOneArray = [realMulMat.floatPtr(0, 0)[0]];
        for (var m = 1; m <= M / 2 - 1; m++) {
            colOneArray.push(realMulMat.floatPtr(m, 0)[0]);
            colOneArray.push(imagMulMat.floatPtr(m, 0)[0]);
        }
        colOneArray.push(realMulMat.floatPtr(M / 2, 0)[0]);

        let colLastArray = [realMulMat.floatPtr(0, N / 2)[0]];
        for (var m = 1; m <= M / 2 - 1; m++) {
            colLastArray.push(realMulMat.floatPtr(m, N / 2)[0]);
            colLastArray.push(imagMulMat.floatPtr(m, N / 2)[0]);
        }
        colLastArray.push(realMulMat.floatPtr(M / 2, N / 2)[0]);

        let dstMatOBJ = new JSMat(cv.Mat.zeros(M, N, cv.CV_32FC1));
        dstMatOBJ.replaceMatFromRect(new JSMat(centerMat), new cv.Rect(1, 0, N - 2, M));
        dstMatOBJ.replaceMatFromCol(colOneArray, 0);
        dstMatOBJ.replaceMatFromCol(colLastArray, N - 1);
        return dstMatOBJ.mat;
    }

    // mat1 and mat2 have 2 channels
    static mulSpectrums2Channel(complexI, complexII, conjB) {
        let planesI = new cv.MatVector();
        cv.split(complexI, planesI);
        let realI = planesI.get(0);
        let imagI = planesI.get(1);

        let planesII = new cv.MatVector();
        cv.split(complexII, planesII);
        let realII = planesII.get(0);
        let imagII = planesII.get(1);
        if (conjB === true) {
            CV.mulConstant(imagII, -1, imagII);
        }
        let realMulMat = new cv.Mat();
        CV.subtract(realI.mul(realII, 1), imagI.mul(imagII, 1), realMulMat);
        let imagMulMat = new cv.Mat();
        CV.add(realI.mul(imagII, 1), imagI.mul(realII, 1), imagMulMat);

        let M = realI.rows;
        let N = realI.cols;

        let centerArray = [];
        for (var m = 0; m <= M - 1; m++) {
            for (var n = 1; n <= N / 2 - 1; n++) {
                centerArray.push(realMulMat.floatPtr(m, n)[0]);
                centerArray.push(imagMulMat.floatPtr(m, n)[0]);
            }
        }
        let centerMat = cv.matFromArray(M, N - 2, cv.CV_32FC1, centerArray);

        let colOneArray = [realMulMat.floatPtr(0, 0)[0]];
        for (var m = 1; m <= M / 2 - 1; m++) {
            colOneArray.push(realMulMat.floatPtr(m, 0)[0]);
            colOneArray.push(imagMulMat.floatPtr(m, 0)[0]);
        }
        colOneArray.push(realMulMat.floatPtr(M / 2, 0)[0]);

        let colLastArray = [realMulMat.floatPtr(0, N / 2)[0]];
        for (var m = 1; m <= M / 2 - 1; m++) {
            colLastArray.push(realMulMat.floatPtr(m, N / 2)[0]);
            colLastArray.push(imagMulMat.floatPtr(m, N / 2)[0]);
        }
        colLastArray.push(realMulMat.floatPtr(M / 2, N / 2)[0]);

        let dstMatOBJ = new JSMat(cv.Mat.zeros(M, N, cv.CV_32FC1));
        dstMatOBJ.replaceMatFromRect(new JSMat(centerMat), new cv.Rect(1, 0, N - 2, M));
        dstMatOBJ.replaceMatFromCol(colOneArray, 0);
        dstMatOBJ.replaceMatFromCol(colLastArray, N - 1);
        return dstMatOBJ.mat;
    }
}
