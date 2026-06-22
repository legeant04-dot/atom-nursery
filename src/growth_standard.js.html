/* growth_standard.js — WHO/Amarin Baby&Kids reference weight (kg) & height (cm)
   bands for boys & girls, newborn → 6 years. Used by the Admin growth Line Chart
   and the teacher bi-monthly growth-update prompt.
   Source table: "ตารางน้ำหนักส่วนสูงของลูกน้อย ตั้งแต่แรกเกิด-6 ปี" (AMARIN Baby&Kids,
   based on กราฟมาตรฐานการเจริญเติบโตขององค์การอนามัยโลก / กรมอนามัย).
   Each row: ageMonth, then [min,max] for weight & height. */
(function () {
  // ageMonth, boyW[min,max], boyH[min,max], girlW[min,max], girlH[min,max]
  var ROWS = [
    [0,  [2.80,3.90],[47.60,53.10], [2.70,3.70],[46.80,52.90]], // แรกเกิด / newborn
    [1,  [3.40,4.70],[50.40,56.20], [3.30,4.40],[49.40,56.00]],
    [2,  [4.20,5.50],[53.20,59.10], [3.80,5.20],[52.00,59.00]],
    [3,  [4.80,6.40],[55.70,61.90], [4.40,6.00],[54.40,61.80]],
    [4,  [5.30,7.10],[58.10,64.60], [4.90,6.70],[56.80,64.50]],
    [5,  [5.80,7.80],[60.60,67.10], [5.30,7.30],[58.90,66.90]],
    [6,  [6.30,8.80],[62.40,69.30], [5.80,7.90],[60.90,69.10]],
    [7,  [6.80,9.00],[64.20,71.30], [6.20,8.50],[62.60,71.10]],
    [8,  [7.20,9.50],[65.90,73.20], [6.60,9.00],[64.20,72.80]],
    [9,  [7.60,9.90],[67.40,75.00], [6.90,9.40],[65.50,74.50]],
    [10, [7.90,10.30],[68.90,76.70],[7.20,9.80],[66.70,76.10]],
    [11, [8.10,10.60],[70.20,78.20],[7.50,10.20],[67.70,78.60]],
    [12, [8.30,11.00],[71.50,79.70],[7.70,10.50],[68.80,78.90]], // 1 ปี
    [24, [10.50,14.40],[82.50,91.50],[9.70,13.70],[80.00,89.90]], // 2 ปี
    [36, [12.10,17.20],[89.40,100.80],[11.50,16.50],[88.10,99.20]], // 3 ปี
    [48, [13.60,19.90],[95.50,108.20],[13.00,19.20],[95.00,106.90]], // 4 ปี
    [60, [15.00,22.60],[102.00,115.10],[14.40,21.70],[101.10,113.90]], // 5 ปี
    [72, [16.60,25.40],[107.70,121.30],[16.10,24.70],[107.40,120.80]] // 6 ปี
  ];

  function bands(gender) {
    var boy = (gender === 'M' || gender === 'ชาย' || gender === 'male');
    return ROWS.map(function (r) {
      var w = boy ? r[1] : r[3], h = boy ? r[2] : r[4];
      return { ageMonth: r[0], weightMin: w[0], weightMax: w[1], heightMin: h[0], heightMax: h[1] };
    });
  }

  // linear-interpolate the standard min/max at an arbitrary ageMonth
  function at(gender, ageMonth, key) {
    var b = bands(gender);
    if (ageMonth <= b[0].ageMonth) return { min: b[0][key + 'Min'], max: b[0][key + 'Max'] };
    if (ageMonth >= b[b.length - 1].ageMonth) { var l = b[b.length - 1]; return { min: l[key + 'Min'], max: l[key + 'Max'] }; }
    for (var i = 1; i < b.length; i++) {
      if (ageMonth <= b[i].ageMonth) {
        var a = b[i - 1], c = b[i], f = (ageMonth - a.ageMonth) / (c.ageMonth - a.ageMonth);
        return { min: a[key + 'Min'] + f * (c[key + 'Min'] - a[key + 'Min']),
                 max: a[key + 'Max'] + f * (c[key + 'Max'] - a[key + 'Max']) };
      }
    }
    return null;
  }

  // classify a measurement against the band: 'low' | 'normal' | 'high'
  function classify(gender, ageMonth, value, key) {
    if (value == null || value === '' || isNaN(+value)) return null;
    var s = at(gender, ageMonth, key); if (!s) return null;
    if (+value < s.min) return 'low';
    if (+value > s.max) return 'high';
    return 'normal';
  }

  window.GROWTH_STD = { rows: ROWS, bands: bands, at: at, classify: classify };
})();
