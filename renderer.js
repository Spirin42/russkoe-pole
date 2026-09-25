/* Deterministic photographic facade. Renderer has no DOM dependencies and also renders in
   Node canvas; Surface composites its tiles in the page. */
(function (root) {
  'use strict';
  const W = 256, H = 224, WORLD = 'russkoe-pole-v1';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mod = (v, n) => (v % n + n) % n;
  function hash(x, y, salt = 0) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  }
  const random = (x, y, salt) => hash(x, y, salt) / 4294967296;
  function describe(x, y) {
    const r = s => random(x, y, s);
    const blank = r(7) < .022;
    return {
      x, y, id: `${x},${y}`, blank,
      balcony: !blank && r(11) < .27,
      open: r(12) < .22,
      ac: !blank && r(17) < .31,
      curtain: r(19) < .68,
      garland: !blank && r(23) < .026,
      purple: r(29) < .016,
      cool: r(30) < .095,
      defaultOn: !blank && r(97) < .43,
      material: hash(x, y, 31) % 10,
      window: hash(x, y, 43) % 117,
      balconyIndex: hash(x, y, 47) % 52,
      wide: r(49) < .42,
      r
    };
  }
  const WINDOW_X = [40, 149, 475, 584, 906, 1016, 1340, 1448, 1768];
  const WINDOW_Y = [86, 178, 270, 362, 453, 544, 636, 727, 819, 910, 1001, 1092, 1183];
  const BALCONY_X = [239, 675, 1108, 1544];
  const BALCONY_Y = [65, 160, 251, 440, 531, 623, 715, 807, 898, 989, 1080, 1171, 1264];
  // Actual outdoor units, sampled with their perspective from the evening photograph.
  const AC = [
    {rect:[70,460,61,51],edge:[[2,5],[55,2],[58,42],[5,46],[1,39]]},
    {rect:[294,479,54,48],edge:[[2,2],[43,1],[51,7],[51,39],[7,44],[1,40]]},
    {rect:[673,500,54,49],edge:[[3,3],[47,2],[51,9],[51,42],[3,43]]},
    {rect:[533,797,55,49],edge:[[3,1],[50,2],[52,40],[9,43],[4,47],[2,43]]},
    {rect:[609,1015,54,41],edge:[[4,5],[48,3],[52,7],[50,35],[6,35]]}
  ];
  const WALLS = [[205, 82, 30, 72], [636, 81, 37, 71], [862, 83, 35, 71], [1070, 84, 35, 70], [202, 355, 32, 76], [632, 358, 40, 74], [1057, 546, 48, 78], [1299, 359, 30, 75]];
  const PALETTE = ['#b6b4a8', '#adb1ae', '#909997', '#b4b0a4', '#8a969c', '#bab9ad', '#a09e92', '#949e9e', '#bcbcaf', '#9d9993'];

  // Measured glazing boundaries. Every pane has its own mask; exterior frames,
  // mullions, transoms and sills never take part in the light switch.
  const paneRows=(xs,ys)=>ys.flatMap(([t,b])=>xs.map(([l,r])=>[l,t,r,b]));
  const pairedPanes=([l,a,b,r,t,bot])=>[[l,t,a,bot],[b,t,r,bot]];
  const REFERENCE_PANES=[
    [.12,.47,.60,.96,.08,.85],[.08,.435,.565,.925,.09,.84],
    [.075,.421,.56,.936,.10,.87],[.075,.425,.56,.925,.10,.87],
    [.09,.43,.575,.95,.08,.84],[.06,.417,.567,.926,.075,.86],
    [.065,.39,.575,.917,.08,.87],[.055,.395,.55,.90,.115,.867],
    [.08,.428,.60,.952,.053,.87],[.055,.428,.57,.917,.075,.876],
    [.07,.43,.54,.948,.077,.91],[.073,.435,.576,.902,.085,.87],
    [.085,.436,.583,.947,.056,.852],[.055,.426,.546,.923,.062,.875],
    [.04,.40,.535,.932,.07,.856],[.074,.39,.533,.845,.069,.838],
    [.06,.40,.548,.902,.092,.85],[.06,.40,.54,.918,.065,.85],
    [.045,.396,.536,.909,.063,.852],[.073,.399,.555,.924,.085,.866],
    [.065,.422,.52,.928,.085,.87],[.069,.428,.551,.912,.06,.852],
    [.06,.414,.562,.90,.06,.848],[.06,.447,.533,.955,.05,.849],
    [.09,.438,.55,.92,.073,.867],[.07,.435,.584,.902,.057,.827],
    [.06,.422,.553,.903,.057,.852],[.05,.43,.56,.899,.067,.85],
    [.06,.395,.543,.934,.04,.804],[.063,.393,.551,.905,.08,.81]
  ].map(pairedPanes);
  // A reviewed set of complete windows replaces the blind fixed-size grid cuts.
  const MAIN_WINDOWS=[
    [2,[0.095,0.125,0.442,0.88],[0.562,0.126,0.892,0.873]],
    [3,[0.071,0.128,0.426,0.881],[0.512,0.124,0.897,0.895]],
    [4,[0.074,0.051,0.481,0.906],[0.565,0.148,0.916,0.888]],
    [5,[0.055,0.137,0.41,0.879],[0.503,0.076,0.902,0.905]],
    [9,[[0.181,0.241],[0.488,0.231],[0.471,0.863],[0.15,0.867]],[0.564,0.168,0.976,0.894]],
    [17,[0.024,0.1,0.491,0.899],[[0.6,0.129],[0.82,0.144],[0.846,0.865],[0.599,0.873]]],
    [18,[0.133,0.079,0.618,0.847],[[0.79,0.076],[0.944,0.076],[0.944,0.843],[0.725,0.849]]],
    [20,[0.058,0.038,0.457,0.873],[0.553,0.082,0.902,0.846]],
    [23,[0.018,0.035,0.449,0.887],[0.541,0.085,0.907,0.857]],
    [26,[0.025,0.056,0.506,0.875],[0.601,0.114,0.842,0.844]],
    [32,[[0.065,0.1],[0.418,0.081],[0.429,0.833],[0.062,0.829]],[0.504,0.061,0.927,0.851]],
    [34,[0.02,0.037,0.414,0.841],[0.499,0.032,0.823,0.813]],
    [36,[0.13,0.055,0.479,0.854],[0.602,0.065,0.938,0.841]],
    [38,[0.084,0.055,0.512,0.824],[0.64,0.055,0.892,0.856]],
    [43,[0.047,0.031,0.388,0.802],[0.504,0.035,0.854,0.81]],
    [49,[0.1,0.014,0.49,0.859],[0.602,0.09,0.93,0.827]],
    [56,[0.098,0.032,0.534,0.806],[0.659,0.031,0.897,0.798]],
    [65,[0.073,0.05,0.371,0.809],[0.467,0.02,0.929,0.836]],
    [67,[0.125,0.06,0.485,0.806],[0.612,0.081,0.934,0.802]],
    [68,[0.094,0.014,0.444,0.797],[0.586,0.014,0.917,0.797]],
    [82,[0.14,0.04,0.6,0.82],[0.76,0.035,0.974,0.815]],
    [83,[0.1,0.016,0.437,0.802],[0.552,0.008,0.976,0.832]],
    [84,[0.075,0.016,0.428,0.8],[0.533,0.015,0.963,0.814]],
    [92,[0.05,0.027,0.471,0.844],[0.581,0.038,0.926,0.807]],
    [95,[0.107,0.036,0.433,0.755],[0.583,0.033,0.91,0.755]],
    [100,[[0.214,0.03],[0.51,0.023],[0.484,0.84],[0.158,0.84]],[0.614,0.056,0.976,0.837]],
    [101,[0.103,0.063,0.448,0.813],[0.565,0.018,0.971,0.836]],
    [37,[0.097,0.06,0.473,0.85],[0.595,0.073,0.923,0.85]],
    [39,[0.086,0.062,0.484,0.828],[0.618,0.032,0.902,0.838]],
    [41,[0.03,0.007,0.41,0.854],[0.505,0.087,0.889,0.823]],
    [45,[0.088,0.041,0.489,0.898],[0.6,0.075,0.921,0.87]],
    [47,[0.06,0.018,0.62,0.85],[0.7,0.018,0.92,0.85]],
    [48,[0.02,0.015,0.65,0.851],[0.731,0.031,0.915,0.847]],
    [57,[0.076,0.025,0.446,0.798],[0.538,0.02,0.946,0.818]],
    [58,[0.12,0.02,0.627,0.817],[0.747,0.017,0.945,0.817]],
    [60,[0.041,0.019,0.529,0.806],[0.644,0.018,0.897,0.803]],
    [66,[0.04,0.013,0.535,0.826],[0.625,0.025,0.94,0.794]],
    [72,[0.138,0.057,0.638,0.835],[0.729,0.022,0.96,0.845]],
    [73,[[0.173,0.023],[0.66,0.023],[0.645,0.142],[0.163,0.151]],[[0.163,0.179],[0.645,0.176],[0.632,0.83],[0.133,0.828]],[0.741,0.02,0.969,0.855]],
    [77,[0.06,0.012,0.294,0.807],[0.374,0.014,0.616,0.777],[0.718,0.01,0.94,0.801]],
    [80,[0.023,0.01,0.409,0.765],[0.493,0.01,0.875,0.741]],
    [81,[0.144,0.044,0.629,0.836],[0.745,0.04,0.963,0.824]],
    [86,[0.072,0.017,0.539,0.791],[0.645,0.017,0.924,0.762]],
    [87,[0.046,0.021,0.426,0.778],[0.524,0.012,0.907,0.764]],
    [93,[0.025,0.005,0.443,0.824],[0.547,0.012,0.946,0.783]],
    [94,[0.119,0.01,0.541,0.814],[0.641,0.01,0.979,0.778]],
    [99,[0.144,0.02,0.518,0.856],[0.626,0.072,0.982,0.844]],
    [102,[0.046,0.004,0.429,0.417],[0.047,0.449,0.429,0.85],[0.548,0.025,0.919,0.82]],
    [105,[0.075,0.01,0.493,0.797],[[0.616,0.017],[0.829,0.017],[0.833,0.81],[0.619,0.742]]],
    [106,[0.06,0.012,0.649,0.763],[0.753,0.013,0.915,0.765]],
    [108,[0.064,0.123,0.474,0.861],[0.594,0.108,0.984,0.859]],
    [109,[0.073,0.115,0.39,0.866],[0.511,0.121,0.976,0.858]],
    [111,[0.092,0.041,0.562,0.797],[0.694,0.02,0.949,0.789]],
    [115,[0.016,0.01,0.462,0.791],[0.551,0.01,0.902,0.77]],
    [116,[0.06,0.015,0.579,0.727],[0.724,0.02,0.93,0.761]]
  ].map(([index,...panes])=>({index,panes}));
  const REFERENCE_BALCONY_PANES=[
    paneRows([[.238,.395],[.439,.596],[.639,.79]],[[.076,.511]]),
    paneRows([[.115,.219],[.254,.357],[.40,.498],[.538,.635],[.672,.773],[.808,.902]],[[.083,.18],[.237,.585]]),
    paneRows([[.095,.251],[.306,.468],[.514,.688],[.738,.895]],[[.035,.132],[.198,.566]]),
    paneRows([[.225,.358],[.407,.559],[.608,.768]],[[.073,.553]]),
    paneRows([[.235,.393],[.44,.59],[.643,.791]],[[.057,.532]]),
    paneRows([[.115,.337],[.403,.612],[.68,.888]],[[.145,.553]]),
    paneRows([[.105,.25],[.304,.466],[.515,.672],[.721,.882]],[[.082,.563]]),
    paneRows([[.104,.216],[.264,.395],[.445,.566],[.614,.744],[.796,.897]],[[.067,.153],[.265,.556]]),
    paneRows([[.10,.302],[.373,.594],[.671,.887]],[[.119,.587]]),
    paneRows([[.233,.38],[.437,.581],[.646,.78]],[[.07,.537]]),
    paneRows([[.238,.393],[.447,.592],[.645,.791]],[[.065,.546]]),
    paneRows([[.094,.17],[.213,.334],[.378,.484],[.523,.626],[.671,.756],[.8,.895]],[[.067,.146],[.215,.565]])
  ];

  const MAIN_BALCONIES=[
    {index:1,half:0,open:false,panes:[[[.095,.193],[.327,.186],[.326,.535],[.094,.549]],[[.397,.178],[.63,.169],[.63,.487],[.395,.506]],[[.695,.163],[.894,.148],[.894,.469],[.694,.482]]]},
    {index:2,half:1,open:false,panes:[[[.071,.155],[.224,.171],[.224,.527],[.071,.514]],[[.281,.171],[.455,.179],[.455,.537],[.28,.525]],[[.512,.18],[.654,.191],[.654,.546],[.511,.535]],[[.709,.194],[.879,.209],[.88,.565],[.708,.549]]]},
    {index:11,half:1,open:false,panes:paneRows([[.127,.289],[.351,.487],[.551,.692],[.748,.909]],[[.169,.538]])},
    {index:13,half:1,open:false,glass:[.026,.105,.839,.85],panes:paneRows([[.03,.398],[.495,.834]],[[.118,.496],[.566,.849]])},
    {index:21,half:1,open:false,panes:paneRows([[.033,.271],[.355,.569],[.643,.837]],[[.159,.492]])},
    {index:3,half:0,open:true,panes:[[[.095,.357],[.287,.345],[.287,.586],[.097,.596]],[[.383,.335],[.715,.329],[.715,.568],[.386,.582]]]},
    {index:15,half:0,open:true,panes:paneRows([[.132,.285],[.347,.575],[.712,.81]],[[.273,.552]])},
    {"index":6,"half":1,"open":false,"panes":[[[0.079,0.115],[0.289,0.135],[0.289,0.522],[0.079,0.511]],[[0.327,0.21],[0.449,0.237],[0.449,0.53],[0.327,0.519]],[[0.498,0.213],[0.651,0.18],[0.651,0.525],[0.498,0.533]],[[0.714,0.114],[0.89,0.127],[0.89,0.551],[0.714,0.537]]]},
    {"index":8,"half":0,"open":false,"panes":[[0.092,0.13,0.311,0.54],[0.404,0.13,0.599,0.54],[0.675,0.13,0.868,0.54]]},
    {"index":8,"half":1,"open":false,"trim":[0.155,0.98],"panes":[[0.203,0.164,0.339,0.529],[0.45,0.164,0.6,0.529],[0.681,0.164,0.829,0.529]]},
    {"index":9,"half":0,"open":false,"panes":[[0.1,0.153,0.335,0.552],[0.413,0.153,0.605,0.552],[0.687,0.153,0.935,0.552]]},
    {"index":9,"half":1,"open":false,"trim":[0.297,0.963],"panes":[[0.331,0.144,0.609,0.554],[0.69,0.144,0.865,0.554]]},
    {"index":13,"half":0,"open":false,"trim":[0.083,1],"panes":[[0.124,0.121,0.245,0.489],[0.301,0.121,0.423,0.489],[0.468,0.121,0.575,0.489],[0.641,0.121,0.744,0.489],[0.794,0.121,0.932,0.489]]},
    {"index":16,"half":0,"open":false,"panes":[[0.104,0.163,0.304,0.559],[0.382,0.163,0.568,0.559],[0.654,0.163,0.851,0.559]]},
    {"index":17,"half":1,"open":false,"trim":[0.217,0.99],"panes":[[0.275,0.145,0.435,0.517],[0.51,0.145,0.686,0.517],[0.741,0.145,0.936,0.517]]},
    {"index":19,"half":0,"open":false,"trim":[0.073,0.871],"panes":[[0.14,0.145,0.322,0.493],[0.386,0.145,0.579,0.493],[0.645,0.145,0.837,0.493]]},
    {"index":19,"half":1,"open":false,"panes":[[0.118,0.136,0.295,0.518],[0.34,0.135,0.49,0.473],[0.567,0.142,0.696,0.482],[0.769,0.152,0.905,0.491]]},
    {"index":20,"half":0,"open":false,"panes":[[0.09,0.135,0.255,0.545],[0.327,0.135,0.482,0.545],[0.535,0.135,0.677,0.545],[0.754,0.135,0.867,0.545]]},
    {"index":22,"half":0,"open":false,"panes":[[0.176,0.122,0.347,0.516],[0.409,0.124,0.549,0.498],[0.648,0.128,0.794,0.506]]},
    {"index":25,"half":0,"open":false,"panes":[[0.115,0.163,0.276,0.512],[0.342,0.163,0.486,0.512],[0.556,0.163,0.718,0.512],[0.782,0.163,0.941,0.512]]},
    {"index":28,"half":1,"open":false,"trim":[0.218,0.99],"panes":[[0.271,0.138,0.423,0.514],[0.483,0.138,0.656,0.514],[0.712,0.138,0.854,0.514]]},
    {"index":30,"half":0,"open":false,"trim":[0.052,0.81],"panes":[[0.099,0.182,0.34,0.488],[0.418,0.182,0.542,0.488],[0.638,0.182,0.775,0.488]]},
    {"index":32,"half":0,"open":true,"glass":[0.29,0.17,0.89,0.6],"panes":[[0.326,0.192,0.528,0.582],[0.63,0.192,0.726,0.582],[0.802,0.192,0.859,0.582]]},
    {"index":36,"half":1,"open":false,"trim":[0.277,0.962],"panes":[[[0.321525,0.18],[0.5099,0.18],[0.5099,0.554],[0.321525,0.554]],[[0.555795,0.157],[0.848975,0.157],[0.848975,0.552],[0.555795,0.552]]]},
    {"index":38,"half":1,"open":false,"trim":[0.11,1],"panes":[[[0.12246,0.21],[0.31114,0.207],[0.31114,0.562],[0.12246,0.558]],[[0.36187,0.204],[0.53809,0.19],[0.53809,0.548],[0.36187,0.55]],[[0.58704,0.187],[0.77038,0.182],[0.77038,0.547],[0.58704,0.547]],[[0.8131,0.18],[0.97419,0.176],[0.97419,0.548],[0.8131,0.545]]]},
    {"index":39,"half":0,"open":false,"panes":[[0.24,0.169,0.4,0.506],[[0.466,0.172],[0.661,0.15],[0.661,0.553],[0.466,0.507]],[0.745,0.138,0.947,0.523]]},
    {"index":41,"half":1,"open":false,"panes":[[[0.284,0.316],[0.44,0.304],[0.44,0.59],[0.284,0.592]],[[0.502,0.285],[0.64,0.278],[0.64,0.583],[0.502,0.589]],[[0.713,0.285],[0.882,0.267],[0.882,0.575],[0.713,0.578]]]},
    {"index":42,"half":1,"open":false,"panes":[[[0.119,0.182],[0.347,0.17],[0.347,0.565],[0.119,0.574]],[[0.403,0.17],[0.626,0.163],[0.626,0.543],[0.403,0.553]],[[0.669,0.159],[0.893,0.152],[0.893,0.523],[0.669,0.534]]]},
    {"index":44,"half":0,"open":false,"panes":[[0.108,0.266,0.266,0.588],[0.36,0.266,0.468,0.588],[0.55,0.266,0.67,0.588],[0.728,0.266,0.873,0.588]]},
    {"index":45,"half":0,"open":false,"panes":[[[0.068,0.233],[0.221,0.241],[0.221,0.647],[0.068,0.64]],[[0.296,0.249],[0.442,0.258],[0.442,0.66],[0.296,0.653]],[[0.52,0.267],[0.682,0.274],[0.682,0.673],[0.52,0.666]],[[0.757,0.279],[0.899,0.291],[0.899,0.686],[0.757,0.678]]]}
  ];
  class Renderer {
    constructor(images, makeCanvas, options = {}) {
      this.images = images;
      this.canvas = makeCanvas;
      this.patterns=new WeakMap();this.dpr=options.dpr||1;
      this.variantCache=new Map();this.variantBytes=0;this.variantBudget=24*1024*1024;
      this.jointCache=new Map();this.jointBytes=0;this.jointPool=new Map();this.jointBands=new Map();
      this.wallBaseCache=new Map();this.wallBaseBytes=0;
      this.lightCache=new Map();this.lightBytes=0;this.lightBudget=32*1024*1024;
      this.apartmentCache=new Map();this.textureIds=new WeakMap();this.nextTextureId=1;this.glassMasks=new WeakMap();
      this.sourcePixels=new WeakMap();
      this.film=this.filmTexture();this.weather=this.weatherTexture();
      this.wallTextures = WALLS.map((r, i) => this.wallTexture(r, i));
      this.jointTexture=this.photoCut('evening',[82,856,210,16],736,420,32,0);
      this.windows = MAIN_WINDOWS.map(a=>this.windowTexture(a.index%9,Math.floor(a.index/9),a.panes));
      this.mainBalconies=MAIN_BALCONIES.map(a=>{
        const col=a.index%4,row=Math.floor(a.index/4);
        const trim=a.trim||[0,1],l=trim[0],width=trim[1]-l;
        let tex=this.photoCut('main',[BALCONY_X[col]-3+a.half*99+l*95,BALCONY_Y[row]-2,95*width,96],1838,Math.round(285*width),288,3);
        const panes=a.panes.map(p=>(typeof p[0]==='number'?[[p[0],p[1]],[p[2],p[1]],[p[2],p[3]],[p[0],p[3]]]:p).map(([x,y])=>[(x-l)/width,y]));
        const glass=a.glass||[.06,.13,.92,.58];
        if(a.open)tex=this.openBalconyTexture(tex,glass);
        return{...a,glass,texture:this.registerGlass(tex,panes)};
      });
      this.balconies=this.mainBalconies.map(a=>a.texture);
      this.aircons = AC.map(a => this.airconTexture(a));
      this.parapets=[[135,239,192,34],[665,403,187,36],[135,558,191,43],[665,553,188,48]].map(rect=>this.photoCut('reference',rect,1000,288,66,0));
      this.windowSurrounds=[
        {rect:[113,669,164,143],opening:[12,13,139,111]},
        {rect:[330,676,125,143],opening:[13,11,100,114]},
        {rect:[112,879,164,131],opening:[13,14,139,109]}
      ].map(a=>this.windowSurround(a));
      this.apartments=[
        {rect:[78,654,214,212],panes:[[135,691,34,82],[177,691,39,85],[224,695,32,89]]},
        {rect:[309,662,186,210],panes:[[352,695,31,33],[352,738,31,46],[395,696,35,88]]},
        {rect:[498,667,225,214],panes:[[562,706,35,79],[605,706,36,85]]},
        {rect:[83,870,211,232],panes:[[132,907,34,85],[181,907,27,85],[218,908,39,84]]},
        {rect:[308,877,188,226],panes:[[352,910,36,83],[397,911,33,84]]},
        {rect:[501,883,225,221],panes:[[563,923,33,81],[607,924,30,84]]}
      ].map(a=>({...a,texture:this.photoCut('evening',a.rect,736,W,H,0)}));
      this.referenceWindows=[
        [9,144,85,90],[372,145,87,90],[536,146,85,89],[893,144,87,91],
        [8,309,87,91],[372,310,86,90],[536,310,85,90],[893,308,87,92],
        [9,473,86,91],[371,473,87,90],[537,473,85,90],[893,474,87,90],
        [9,637,85,91],[372,637,86,90],[537,637,85,91],[893,637,88,91],
        [9,800,85,91],[371,800,87,91],[537,800,85,91],[893,800,86,91]
      ].map((r,i)=>this.windowPhoto('reference',r,1000,REFERENCE_PANES[i]));
      this.referenceBalconies=[
        {rect:[128,141,208,143],open:true,glass:[.23,.055,.8,.51]},
        {rect:[657,107,204,176],open:false,glass:[.13,.10,.91,.62]},
        {rect:[129,282,204,165],open:false,glass:[.11,.12,.90,.59]},
        {rect:[657,308,204,140],open:true,glass:[.23,.075,.78,.57]},
        {rect:[129,471,204,143],open:true,glass:[.22,.055,.80,.55]},
        {rect:[657,450,204,165],open:false,glass:[.095,.08,.92,.59]},
        {rect:[128,614,205,165],open:false,glass:[.095,.12,.90,.64]},
        {rect:[657,614,204,165],open:false,glass:[.12,.13,.9,.62]}
      ].map(a=>({...a,texture:this.photoCut('reference',a.rect,1000,306,Math.round(a.rect[3]*1.5),2)}));
      for(const r of [[326,192,76,83],[612,194,77,83],[325,337,78,82],[610,337,76,83],[327,480,76,78],[610,480,76,82],[327,621,77,80],[609,621,77,81],[327,762,77,83],[608,762,80,81]])this.referenceWindows.push(this.windowPhoto('reference-extra',r,1000,REFERENCE_PANES[this.referenceWindows.length]));
      for(const a of [{rect:[115,158,180,158],open:false,glass:[.16,.13,.85,.61]},{rect:[115,335,182,125],open:true,glass:[.23,.04,.79,.53]},{rect:[116,479,181,123],open:true,glass:[.23,.02,.79,.57]},{rect:[115,602,181,145],open:false,glass:[.12,.08,.92,.62]}])this.referenceBalconies.push({...a,texture:this.photoCut('reference-extra',a.rect,1000,306,Math.round(a.rect[3]*1.7),2)});
      for(const [i,a] of this.referenceBalconies.entries()){
        if(a.open)a.texture=this.openBalconyTexture(a.texture,a.glass);
        this.registerGlass(a.texture,REFERENCE_BALCONY_PANES[i]);
      }
      this.mosaicTextures=[[465,155,24,45],[624,317,28,45],[465,489,24,40],[464,812,26,35]].map(r=>{
        const c=this.canvas(W,H),g=c.getContext('2d');
        for(let y=0;y<H+r[3];y+=r[3])for(let x=0;x<W+r[2];x+=r[2]){
          g.save();g.translate(x+(Math.floor(x/r[2])%2?r[2]:0),y+(Math.floor(y/r[3])%2?r[3]:0));g.scale(Math.floor(x/r[2])%2?-1:1,Math.floor(y/r[3])%2?-1:1);this.crop(g,'reference',r,1000,0,0,r[2],r[3]);g.restore();
        }
        // Remove repeating low-frequency exposure from a small source patch while retaining real tile joints.
        const a=g.getImageData(0,0,W,H),p=a.data,sums=new Float64Array((W+1)*(H+1)),stride=W+1;
        for(let y=1;y<=H;y++){let row=0;for(let x=1;x<=W;x++){const i=((y-1)*W+x-1)*4;row+=p[i]*.26+p[i+1]*.57+p[i+2]*.17;sums[y*stride+x]=sums[(y-1)*stride+x]+row;}}
        for(let y=0;y<H;y++)for(let x=0;x<W;x++){
          const x0=Math.max(0,x-4),x1=Math.min(W,x+5),y0=Math.max(0,y-4),y1=Math.min(H,y+5);
          const mean=(sums[y1*stride+x1]-sums[y0*stride+x1]-sums[y1*stride+x0]+sums[y0*stride+x0])/((x1-x0)*(y1-y0));
          const i=(y*W+x)*4,delta=(117-mean)*.94;p[i]+=delta;p[i+1]+=delta;p[i+2]+=delta;
        }
        g.putImageData(a,0,0);return c;
      });
    }
    variant(key,paint) {
      if(this.variantCache.has(key)){const c=this.variantCache.get(key);this.variantCache.delete(key);this.variantCache.set(key,c);return c;}
      const c=paint();this.textureIds.set(c,'variant:'+key);this.variantCache.set(key,c);this.variantBytes+=c.width*c.height*4;
      while(this.variantBytes>this.variantBudget&&this.variantCache.size>1){const k=this.variantCache.keys().next().value,t=this.variantCache.get(k);this.variantCache.delete(k);this.variantBytes-=t.width*t.height*4;t.width=1;t.height=1;}return c;
    }
    textureId(texture) {
      if(!this.textureIds.has(texture))this.textureIds.set(texture,this.nextTextureId++);
      return this.textureIds.get(texture);
    }
    windowLayout(texture,layout) {
      const glass=this.glassMasks.get(texture);
      if(!layout||glass.panes.length!==2)return texture;
      return this.variant(`window:${this.textureId(texture)}:${layout}`,()=>{
        const polys=glass.panes.map(p=>typeof p[0]==='number'?[[p[0],p[1]],[p[2],p[1]],[p[2],p[3]],[p[0],p[3]]]:p);
        const boxes=polys.map(p=>({l:Math.min(...p.map(v=>v[0])),r:Math.max(...p.map(v=>v[0]))})).sort((a,b)=>a.l-b.l);
        const [left,right]=boxes,gap=right.l-left.r,mid=(left.r+right.l)/2;
        const segments=layout===1?[[0,mid],[right.r+.002,1]]:layout===2?[[0,left.l-.002],[mid,1]]:layout===3?[[0,mid],[Math.max(0,left.l-gap/2),mid],[mid,1]]:[[0,mid],[mid,Math.min(1,right.r+gap/2)],[mid,1]];
        const w=texture.width,h=texture.height,widths=segments.map(([a,b])=>Math.max(1,Math.round((b-a)*w))),nw=widths.reduce((a,b)=>a+b,0);
        const c=this.canvas(nw,h),g=c.getContext('2d'),panes=[];let x=0;
        for(let i=0;i<segments.length;i++){
          const [a,b]=segments[i],ww=widths[i];g.drawImage(texture,a*w,0,(b-a)*w,h,x,0,ww,h);
          for(const poly of polys)if(poly.every(([px])=>px>=a-.0001&&px<=b+.0001))panes.push(poly.map(([px,y])=>[(x+(px-a)/(b-a)*ww)/nw,y]));
          x+=ww;
        }
        // A continuous photographed lintel and sill hide the joins between sashes.
        const ys=polys.flatMap(p=>p.map(v=>v[1])),top=Math.max(0,Math.min(...ys)-.008)*h,bottom=Math.min(1,Math.max(...ys)+.015)*h;
        if(top>1)g.drawImage(texture,0,0,w,top,0,0,nw,top);
        if(bottom<h-1)g.drawImage(texture,0,bottom,w,h-bottom,0,bottom,nw,h-bottom);
        return this.registerGlass(c,panes);
      });
    }
    balconyFinish(texture,finish,glass) {
      if(!finish)return texture;
      const masks=this.glassMasks.get(texture),maxGlass=Math.max(...masks.panes.flatMap(p=>typeof p[0]==='number'?[p[3]]:p.map(v=>v[1])));
      if(maxGlass>.75)return texture;
      return this.variant(`balcony:${this.textureId(texture)}:${finish}`,()=>{
        const w=texture.width,h=texture.height,c=this.canvas(w,h),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(texture,0,0);
        // Only the inset cladding changes. The photographed handrail, slab,
        // silhouette and window mullions are preserved, together with their depth.
        const top=Math.max(maxGlass+.085,glass[3]+.075),hh=h*(.96-top);
        if(hh>10){const panel=this.canvas(w,Math.ceil(hh)),q=panel.getContext('2d');q.drawImage(this.parapets[(finish-1)%this.parapets.length],0,0,w,hh);
          const a=q.getImageData(0,0,w,panel.height);for(let y=0;y<panel.height;y++)for(let x=0;x<w;x++)a.data[(y*w+x)*4+3]*=clamp(Math.min((x-w*.035)/3,(w*.965-x)/3,y/3,(hh-y)/3),0,1)*.88;
          q.putImageData(a,0,0);g.drawImage(panel,0,h*top);
        }
        return this.registerGlass(c,masks.panes);
      });
    }
    crop(ctx, name, rect, units, x, y, w, h) {
      const im = this.images[name], f = im.width / units;
      ctx.drawImage(im, rect[0]*f, rect[1]*f, rect[2]*f, rect[3]*f, x, y, w, h);
    }
    photoCut(name, rect, units, width, height, feather) {
      const c = this.canvas(width, height), g = c.getContext('2d',{willReadFrequently:true});
      this.crop(g, name, rect, units, 0, 0, width, height);
      if (feather) {
        const a = g.getImageData(0, 0, width, height);
        for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
          const edge = Math.min(x, y, width-1-x, height-1-y);
          a.data[(y*width+x)*4+3] = Math.round(255*clamp(edge/feather, 0, 1));
        }
        g.putImageData(a, 0, 0);
      }
      return c;
    }
    airconTexture(a) {
      const s=2,c=this.canvas(a.rect[2]*s,a.rect[3]*s),g=c.getContext('2d');
      this.crop(g,'evening',a.rect,736,0,0,c.width,c.height);
      // Clip to the photographed casing, rather than carrying a rectangle of foreign wall.
      g.globalCompositeOperation='destination-in';g.fillStyle='#fff';g.beginPath();
      a.edge.forEach(([x,y],i)=>i?g.lineTo(x*s,y*s):g.moveTo(x*s,y*s));g.closePath();g.fill();
      return c;
    }
    windowSurround(a) {
      // Preserve actual chipped plaster, the reveals and the sill around an opening.
      const c=this.photoCut('evening',a.rect,736,a.rect[2]*2,a.rect[3]*2,14),g=c.getContext('2d');
      const pixels=g.getImageData(0,0,c.width,c.height),p=pixels.data;
      for(let i=0;i<p.length;i+=4){p[i]*=.87;p[i+1]*=.88;p[i+2]*=.89;}
      const cutoff=(a.opening[1]+a.opening[3]+6)*2;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)p[(y*c.width+x)*4+3]*=clamp((cutoff-y)/5,0,1);
      g.putImageData(pixels,0,0);
      g.globalCompositeOperation='destination-out';g.fillStyle='#fff';
      g.fillRect(a.opening[0]*2,a.opening[1]*2,a.opening[2]*2,a.opening[3]*2);
      return{texture:c,opening:a.opening.map(v=>v*2)};
    }
    openBalconyTexture(texture,glass) {
      // Remove the foreign wall either side of the rear window. It should share
      // the apartment's masonry, while the photographed parapet stays intact.
      const c=this.canvas(texture.width,texture.height),g=c.getContext('2d');g.drawImage(texture,0,0);
      const a=g.getImageData(0,0,c.width,c.height),p=a.data,rail=glass[3]+.035;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
        const xx=x/c.width,yy=y/c.height;
        const windowMask=clamp(Math.min((xx-glass[0]+.06)/.035,(glass[2]+.06-xx)/.035),0,1);
        const parapet=clamp((yy-rail+.018)/.018,0,1);
        p[(y*c.width+x)*4+3]*=Math.max(windowMask,parapet);
      }
      g.putImageData(a,0,0);return c;
    }
    polygon(g,points) {
      g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();
    }
    texturedPlane(g,texture,points,shade,source) {
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
      g.save();this.polygon(g,points);g.clip();
      if(source)g.drawImage(texture,...source,x,y,w,h);else g.drawImage(texture,x,y,w,h);
      this.tint(g,x,y,w,h,'#15212c',shade);g.restore();
    }
    runoff(g,d,x,y,w,length,strength=.12) {
      // Small irregular damp marks connect an architectural element to its wall.
      g.save();
      for(let i=0;i<8;i++){
        const xx=x+w*d.r(160+i),ww=1.5+d.r(180+i)*6,hh=length*(.25+d.r(200+i)*.75);
        const stain=g.createLinearGradient(0,y,0,y+hh);
        stain.addColorStop(0,`rgba(18,25,28,${strength*(.35+d.r(220+i)*.65)})`);stain.addColorStop(1,'rgba(18,25,28,0)');
        g.fillStyle=stain;g.beginPath();g.moveTo(xx,y);g.lineTo(xx+ww,y);g.lineTo(xx+ww*.5,y+hh);g.lineTo(xx+ww*.2,y+hh*.65);g.fill();
      }
      g.restore();
    }
    wallTexture(rect, i) {
      const c = this.canvas(W, H), g = c.getContext('2d');
      // Mirror real, unobstructed concrete to extend its fine grain without stretching it.
      const samples=[[79,596,181,43],[350,602,108,43],[77,812,189,39],[348,811,112,41]];
      const r=samples[i%4],sw=r[2],sh=r[3];
      for(let y=0;y<H+sh;y+=sh)for(let x=0;x<W+sw;x+=sw){
        g.save();g.translate(x+(Math.floor(x/sw)%2?sw:0),y+(Math.floor(y/sh)%2?sh:0));g.scale(Math.floor(x/sw)%2?-1:1,Math.floor(y/sh)%2?-1:1);
        this.crop(g,'evening',r,736,0,0,sw,sh);g.restore();
      }
      const a = g.getImageData(0, 0, W, H);
      for (let p=0; p<a.data.length; p+=4) {
        const l = a.data[p]*.26+a.data[p+1]*.57+a.data[p+2]*.17;
        const n = (hash(p/4, i, 12)/4294967296-.5)*9;
        const bright=l*1.32+16;
        a.data[p] = bright*.94+n; a.data[p+1]=bright*.985+n; a.data[p+2]=bright*1.015+n;
      }
      g.putImageData(a, 0, 0);
      return c;
    }
    registerGlass(texture,panes) {
      const w=texture.width,h=texture.height,c=this.canvas(w,h),g=c.getContext('2d',{willReadFrequently:true});
      g.fillStyle='#fff';
      for(const pane of panes){
        const polygon=typeof pane[0]==='number'?[[pane[0],pane[1]],[pane[2],pane[1]],[pane[2],pane[3]],[pane[0],pane[3]]]:pane;
        this.polygon(g,polygon.map(([x,y])=>[x*w,y*h]));g.fill();
      }
      const p=g.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
      for(let i=0;i<mask.length;i++)mask[i]=p[i*4+3];
      this.glassMasks.set(texture,{pixels:mask,panes});return texture;
    }
    windowPhoto(name,r,units,panes) {
      // Include the complete sill and frame; alpha fades only in the surrounding wall.
      const pad=3,rect=[r[0]-pad,r[1]-pad,r[2]+pad*2,r[3]+pad*2];
      const c=this.photoCut(name,rect,units,144,Math.round(144*rect[3]/rect[2]),9);
      const polygons=panes.map(p=>(typeof p[0]==='number'?[[p[0],p[1]],[p[2],p[1]],[p[2],p[3]],[p[0],p[3]]]:p).map(([x,y])=>[(x*r[2]+pad)/rect[2],(y*r[3]+pad)/rect[3]]));
      return this.registerGlass(c,polygons);
    }
    windowTexture(col, row,panes) {
      const x = WINDOW_X[col], y=WINDOW_Y[row];
      const drift=(row/12)*((col===0||col===1)?-3:col>5?2:0);
      return this.windowPhoto('main',[x+drift-1,y-1,53,57],1838,panes);
    }
    filmTexture() {
      const size=512,c=this.canvas(size,size),g=c.getContext('2d'),a=g.createImageData(size,size),p=a.data;
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        // Static, monochrome emulsion grain shared by windows, walls and balconies.
        const n=(random(x,y,301)+random(x,y,302)+random(x,y,303)+random(x,y,304)-2)*76;
        const i=(y*size+x)*4;p[i]=p[i+1]=p[i+2]=128+n;p[i+3]=255;
      }
      g.putImageData(a,0,0);return c;
    }
    weatherTexture() {
      const size=512,c=this.canvas(size,size),g=c.getContext('2d'),a=g.createImageData(size,size),p=a.data;
      const smooth=t=>t*t*(3-2*t);
      const noise=(x,y,nx,ny,salt)=>{
        const xx=x/size*nx,yy=y/size*ny,ix=Math.floor(xx),iy=Math.floor(yy),fx=smooth(xx-ix),fy=smooth(yy-iy);
        const v=(dx,dy)=>random((ix+dx)%nx,(iy+dy)%ny,salt);
        return (v(0,0)*(1-fx)+v(1,0)*fx)*(1-fy)+(v(0,1)*(1-fx)+v(1,1)*fx)*fy;
      };
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        // Continuous exposure and damp streaks cross apartment boundaries.
        const n=noise(x,y,4,4,310)*.40+noise(x,y,8,8,311)*.26+noise(x,y,24,24,312)*.18+noise(x,y,96,6,313)*.16;
        const v=128+(n-.5)*170,i=(y*size+x)*4;p[i]=v+2;p[i+1]=v+1;p[i+2]=v-2;p[i+3]=255;
      }
      g.putImageData(a,0,0);return c;
    }
    finishCell(g,x,y,scale,px,py,top=0,bottom=Math.round(H*scale)) {
      // The shared grade, weathering and grain belong to the photograph of the wall,
      // not to the screen: they are painted once per cell and move with the facade.
      const w=Math.round(W*scale),h=bottom-top;
      g.save();g.setTransform(1,0,0,1,0,0);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
      this.tint(g,px,py+top,w,h,'#858585',.15,'saturation');
      this.tint(g,px,py+top,w,h,'#a6a69f',.16,'multiply');
      this.tint(g,px,py+top,w,h,'#746e62',.17,'soft-light');
      let patterns=this.patterns.get(g);
      if(!patterns){patterns={weather:g.createPattern(this.weather,'repeat'),film:g.createPattern(this.film,'repeat')};this.patterns.set(g,patterns);}
      g.globalCompositeOperation='soft-light';
      // Weathering repeats every 4096 facade units from facade zero, 8 units per texel.
      const k=8*scale,wx=mod(x*W,4096)/8,wy=mod(y*H,4096)/8;
      g.globalAlpha=.48;g.fillStyle=patterns.weather;g.setTransform(k,0,0,k,px-wx*k,py-wy*k);g.fillRect(wx,wy+top/k,w/k,h/k);
      // Grain is continuous across apartments. At the nominal zoom of every detail
      // level a grain is .72 CSS px, the size of the former screen overlay.
      const grain=.72*this.dpr,period=512*grain,gx=mod(x*w,period)/grain,gy=mod(y*Math.round(H*scale),period)/grain;
      g.globalAlpha=.24;g.fillStyle=patterns.film;g.setTransform(grain,0,0,grain,px-gx*grain,py-gy*grain);g.fillRect(gx,gy+top/grain,w/grain,h/grain);
      g.restore();
    }
    tint(g, x,y,w,h,color,alpha,mode='multiply') {
      g.save();g.globalAlpha=alpha;g.globalCompositeOperation=mode;g.fillStyle=color;g.fillRect(x,y,w,h);g.restore();
    }
    paintCell(g,d,on,scale,px,py,top=0,bottom=Math.round(H*scale)) {
      // Paint straight into a tile, clipped to the apartment as its own canvas used to be.
      // A band of rows [top, bottom) lets a large apartment be painted over several frames.
      g.save();g.setTransform(1,0,0,1,0,0);g.beginPath();g.rect(px,py+top,Math.round(W*scale),bottom-top);g.clip();
      g.setTransform(scale,0,0,scale,px,py);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
      this.drawCell(g,d,on,scale);g.restore();
      this.finishCell(g,d.x,d.y,scale,px,py,top,bottom);
    }
    renderCell(d,on,scale=1) {
      const c=this.canvas(Math.round(W*scale),Math.round(H*scale));
      this.paintCell(c.getContext('2d'),d,on,scale,0,0);return c;
    }
    prepareCell(d,on,scale) {
      // Every pixel readback an apartment needs happens here, before any of it is drawn. A
      // readback waits for all drawing queued before it, and in Safari, and in Chrome with a
      // GPU canvas, that drawing runs in another process: drawn first, it would stall this one.
      if(d.blank)return;
      if(!d.balcony&&d.r(49)<.12)this.apartmentPhoto(d,on);
      else if(d.balcony){const [tex,glass]=this.balconyOf(d);this.relight(tex,d,on,true,glass,scale);}
      else this.relight(this.windowOf(d)[1],d,on,false,null,scale);
    }
    drawCell(g,d,on,s) {
      g.imageSmoothingEnabled=false;g.drawImage(this.wallBase(d,s),0,0,W,H);g.imageSmoothingEnabled=true;
      // Exposure and repairs remain unique to every apartment.
      this.tint(g,0,0,W,H,'#303637',d.r(52)*.27);
      const wash=g.createLinearGradient(0,0,W,H);
      wash.addColorStop(0,'rgba(220,218,201,.035)');wash.addColorStop(.48,'rgba(0,0,0,0)');wash.addColorStop(1,'rgba(7,17,24,.10)');g.fillStyle=wash;g.fillRect(0,0,W,H);
      if(d.r(55)<.11) {
        // A recently insulated or repainted panel, not a separate building.
        this.tint(g,5,6,W-10,H-12,['#a8aaa7','#b5b09d','#7c939b'][hash(d.x,d.y,56)%3],.23,'source-over');
      }
      this.tint(g,0,0,W,H,'#26323c',.19);
      const fullPhoto=!d.blank&&!d.balcony&&d.r(49)<.12;
      if(fullPhoto)this.drawApartment(g,d,on);
      this.drawJoints(g,d);
      if(!d.blank&&!fullPhoto) {
        if(d.balcony) this.drawBalcony(g,d,on);
        else this.drawWindow(g,d,on);
        if(d.ac&&!d.balcony) this.drawAircon(g,d);
      } else if(d.blank&&d.r(18)<.42) {
        g.fillStyle='#252f33';g.fillRect(199,146,17,9);g.fillStyle='#96a09c66';g.fillRect(199,155,18,1);
      }
      if(d.r(67)<.16) this.drawCable(g,d);
    }
    wallBase(d,s) {
      const mosaic=d.r(51)<.68;
      const index=hash(d.x,d.y,50)%(mosaic?4:8),key=`${mosaic}:${index}:${d.material}:${s}`;
      if(this.wallBaseCache.has(key)){const c=this.wallBaseCache.get(key);this.wallBaseCache.delete(key);this.wallBaseCache.set(key,c);return c;}
      const c=this.canvas(Math.round(W*s),Math.round(H*s)),g=c.getContext('2d');g.scale(s,s);g.imageSmoothingQuality='high';
      g.drawImage(mosaic?this.mosaicTextures[index]:this.wallTextures[index],0,0,W,H);
      this.tint(g,0,0,W,H,PALETTE[d.material],mosaic?.24:.50);
      if(mosaic&&[2,4,5,8].includes(d.material))this.tint(g,0,0,W,H,'#9ba3a4',.76,'color');
      this.tint(g,0,0,W,H,'#435267',mosaic?.10:.25);
      this.wallBaseCache.set(key,c);this.wallBaseBytes+=c.width*c.height*4;
      while(this.wallBaseBytes>12*1024*1024&&this.wallBaseCache.size>1){const first=this.wallBaseCache.keys().next().value,old=this.wallBaseCache.get(first);this.wallBaseCache.delete(first);this.wallBaseBytes-=old.width*old.height*4;old.width=1;old.height=1;}
      return c;
    }
    jointProfile(axis,boundary,segment,length) {
      // Both apartments sharing an edge evaluate the same profile, even below zero.
      const salt=axis?730:710;
      const noise=(t,step,seed)=>{const k=Math.floor(t/step),f=t/step-k,u=f*f*(3-2*f);return random(boundary,k,salt+seed)*(1-u)+random(boundary,k+1,salt+seed)*u;};
      const repaired=random(boundary,Math.floor(segment/3),salt+50)>.69;
      const points=[];
      for(let t=0;t<=length;t+=4){
        const pos=segment*length+t,center=(noise(pos,39,1)-.5)*1.9+(noise(pos,9,2)-.5)*.65;
        const width=(repaired?3.7:2.25)+noise(pos,67,3)*1.3;
        const chip=noise(pos,5,4)*.9;
        points.push({t,center,lo:center-width-chip,hi:center+width+chip*.7});
      }
      return{points,repaired};
    }
    drawJoint(g,axis,boundary,segment,position,length) {
      const scale=g.getTransform().a,key=`${axis}:${boundary}:${segment}:${scale}`;
      let c=this.jointCache.get(key);
      if(!c){
        // Joint canvases of one size are reused: creating a canvas costs about as much as painting a joint.
        const pad=12,w=Math.ceil((axis?pad*2:length)*scale),h=Math.ceil((axis?length:pad*2)*scale),pool=this.jointPool.get(w+'x'+h);
        c=pool&&pool.pop();
        if(c){const q=c.getContext('2d');q.setTransform(1,0,0,1,0,0);q.clearRect(0,0,w,h);}else c=this.canvas(w,h);
        const q=c.getContext('2d');q.setTransform(scale,0,0,scale,0,0);this.paintJoint(q,axis,boundary,segment,pad,length);
        this.jointCache.set(key,c);this.jointBytes+=c.width*c.height*4;
        while(this.jointBytes>8*1024*1024&&this.jointCache.size>1){
          const first=this.jointCache.keys().next().value,old=this.jointCache.get(first);this.jointCache.delete(first);this.jointBytes-=old.width*old.height*4;
          const size=old.width+'x'+old.height,spare=this.jointPool.get(size)||[];
          if(spare.length<64){spare.push(old);this.jointPool.set(size,spare);}else{old.width=1;old.height=1;}
        }
      }else{this.jointCache.delete(key);this.jointCache.set(key,c);}
      g.drawImage(c,axis?position-12:0,axis?0:position-12,c.width/scale,c.height/scale);
    }
    paintJoint(g,axis,boundary,segment,position,length) {

      const {points,repaired}=this.jointProfile(axis,boundary,segment,length);
      g.save();if(axis)g.transform(0,1,1,0,position,0);else g.translate(0,position);
      const strip=(extra,color)=>{
        g.beginPath();points.forEach((p,i)=>i?g.lineTo(p.t,p.lo-extra):g.moveTo(p.t,p.lo-extra));
        for(let i=points.length-1;i>=0;i--)g.lineTo(points[i].t,points[i].hi+extra);
        g.closePath();g.fillStyle=color;g.fill();
      };
      // Weathered edges, a variable bead of mastic, then the recessed center.
      strip(3.2,'rgba(14,23,27,.09)');strip(1.4,'rgba(15,24,28,.17)');
      strip(0,repaired?'#777b70':'#4c5553');
      // The texture band is the same in every joint of a level: it is resampled once, in the
      // joint canvas's own transform, and laid on pixel for pixel.
      const band=this.jointBand(g,length);
      g.save();g.clip();g.globalCompositeOperation='soft-light';g.globalAlpha=.83;
      g.setTransform(1,0,0,1,0,0);g.drawImage(band,0,0);g.restore();
      g.beginPath();points.forEach((p,i)=>i?g.lineTo(p.t,p.center-.45):g.moveTo(p.t,p.center-.45));
      g.strokeStyle=repaired?'rgba(34,42,40,.19)':'rgba(15,24,28,.73)';g.lineWidth=repaired?.7:1.45;g.stroke();
      g.beginPath();points.forEach((p,i)=>i?g.lineTo(p.t,p.hi+.25):g.moveTo(p.t,p.hi+.25));
      g.strokeStyle='rgba(174,175,155,.22)';g.lineWidth=.6;g.stroke();
      // Granular mortar, short detachments and local repairs interrupt the line.
      for(let i=1;i<points.length-1;i++){
        const p=points[i],r=random(boundary,segment*257+i,axis?793:773);
        g.fillStyle=r>.45?'rgba(192,188,164,.16)':'rgba(13,25,30,.23)';
        g.fillRect(p.t,p.lo+.3+r*(p.hi-p.lo),.5+r*1.2,.3+r*.6);
        if(r>.92){
          g.strokeStyle='rgba(13,23,26,.60)';g.lineWidth=.5;g.beginPath();
          g.moveTo(p.t-4,p.lo+.3);g.lineTo(p.t,p.lo-.25);g.lineTo(p.t+2,p.lo+1.3);g.lineTo(p.t+7,p.lo+.5);g.stroke();
        }
      }
      g.restore();
    }
    jointBand(g,length) {
      const m=g.getTransform(),w=g.canvas.width,h=g.canvas.height,key=[m.a,m.b,m.c,m.d,m.e,m.f,w,h].join();
      let band=this.jointBands.get(key);
      if(!band){band=this.canvas(w,h);const q=band.getContext('2d');q.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);q.drawImage(this.jointTexture,0,-7,length,14);this.jointBands.set(key,band);}
      return band;
    }
    drawJoints(g,d) {
      this.drawJoint(g,0,d.y,d.x,0,W);this.drawJoint(g,0,d.y+1,d.x,H,W);
      this.drawJoint(g,1,d.x,d.y,0,H);this.drawJoint(g,1,d.x+1,d.y,W,H);
      if(d.r(749)<.30)this.runoff(g,d,5,4,W-10,23,.12);
    }
    apartmentPhoto(d,on){
      const index=hash(d.x,d.y,88)%this.apartments.length,key=index+':'+(on?(d.purple?'purple':d.cool?'cool':'warm'):'off');
      let c=this.apartmentCache.get(key);
      if(!c){
      const a=this.apartments[index];c=this.canvas(W,H);const q=c.getContext('2d');q.drawImage(a.texture,0,0);
      const pixels=q.getImageData(0,0,W,H),p=pixels.data;
      const warm=d.purple?[239,134,237]:d.cool?[232,239,218]:[255,201,120];
      const panes=a.panes.map(r=>({x:(r[0]-a.rect[0])*W/a.rect[2],y:(r[1]-a.rect[1])*H/a.rect[3],w:r[2]*W/a.rect[2],h:r[3]*H/a.rect[3]}));
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        const i=(y*W+x)*4,r=p[i],green=p[i+1],b=p[i+2],lum=(r*.26+green*.57+b*.17)/255;
        const pane=panes.find(v=>x>=v.x&&x<v.x+v.w&&y>=v.y&&y<v.y+v.h);
        if(pane){
          const mask=clamp(Math.min(x-pane.x,y-pane.y,pane.x+pane.w-x,pane.y+pane.h-y),0,1);
          const l=on?.33+Math.sqrt(lum)*.94:lum*.38;
          const color=on?warm:[163,183,201];
          p[i]=r*.8*(1-mask)+color[0]*l*mask;p[i+1]=green*.84*(1-mask)+color[1]*l*mask;p[i+2]=b*.9*(1-mask)+color[2]*l*mask;
        }else{p[i]=r*.66;p[i+1]=green*.71;p[i+2]=b*.78;}
      }
      q.putImageData(pixels,0,0);this.apartmentCache.set(key,c);
      }
      return c;
    }
    drawApartment(g,d,on){
      g.drawImage(this.apartmentPhoto(d,on),0,0);
      if(on)this.glow(g,d,W*.21,H*.16,W*.6,H*.58,.18);
      if(d.garland)this.garland(g,d,W*.25,H*.26,W*.49,H*.24,on);
    }
    windowOf(d) {
      const reference=d.r(89)<.56;
      const base=reference?this.referenceWindows[hash(d.x,d.y,90)%this.referenceWindows.length]:this.windows[hash(d.x,d.y,43)%this.windows.length];
      const choice=hash(d.x,d.y,271)%10,layout=choice<6?0:choice-5;
      return [base,this.windowLayout(base,layout)];
    }
    drawWindow(g,d,on) {
      const [base,texture]=this.windowOf(d);
      const wh=116+d.r(278)*8,ww=clamp((d.wide?125:108)*texture.width/base.width,66,196);
      const x=(W-ww)/2+(d.r(61)-.5)*8,y=34+(d.r(62)-.5)*5;
      const setting=this.windowSurrounds[hash(d.x,d.y,151)%this.windowSurrounds.length],o=setting.opening;
      const surround=setting.texture,sx=ww/o[2],sy=wh/o[3];
      this.runoff(g,d,x-3,y+wh,ww+6,31,.16);
      g.save();
      const s=g.getTransform().a;
      g.shadowColor='#0c151d80';g.shadowBlur=1.5*s;g.shadowOffsetX=.5*s;g.shadowOffsetY=1.5*s;
      g.fillStyle='#162026';g.fillRect(x,y,ww,wh);g.restore();
      g.drawImage(this.relight(texture,d,on,false,null,s),x,y,ww,wh);
      // Real chipped reveals and projecting sills carry the depth. Avoid a drawn bevel
      // around the whole window: that would read as a separate picture frame.
      g.drawImage(surround,x-o[0]*sx,y-o[1]*sy,surround.width*sx,surround.height*sy);
      const shade=g.createLinearGradient(0,y,0,y+5);shade.addColorStop(0,'#0b141a50');shade.addColorStop(1,'#0b141a00');
      g.fillStyle=shade;g.fillRect(x,y,ww,5);
      if(on)this.glow(g,d,x,y,ww,wh,.23);
      if(d.garland) this.garland(g,d,x+ww*.09,y+wh*.15,ww*.77,wh*.60,on);
    }
    glow(g,d,x,y,w,h,alpha) {
      g.save();
      const color=d.purple?'196,105,206':d.cool?'215,222,193':'241,170,78';
      g.globalCompositeOperation='screen';
      const rad=g.createRadialGradient(x+w/2,y+h*.55,4,x+w/2,y+h*.55,w*.83);
      rad.addColorStop(0,`rgba(${color},${alpha})`);rad.addColorStop(.48,`rgba(${color},${alpha*.60})`);rad.addColorStop(.76,`rgba(${color},${alpha*.22})`);rad.addColorStop(1,`rgba(${color},0)`);
      g.fillStyle=rad;g.fillRect(x-w*.4,y-h*.3,w*1.8,h*1.6);g.restore();
    }
    balconyOf(d) {
      let tex,glass;
      if(d.r(91)<.46){const candidates=this.referenceBalconies.filter(b=>b.open===d.open),a=candidates[hash(d.x,d.y,92)%candidates.length];tex=a.texture;glass=a.glass;}
      else{const candidates=this.mainBalconies.filter(b=>b.open===d.open),a=candidates[d.balconyIndex%candidates.length];tex=a.texture;glass=a.glass;}
      const finish=hash(d.x,d.y,273)%8;
      return [this.balconyFinish(tex,finish<4?0:finish-3,glass),glass];
    }
    drawBalcony(g,d,on) {
      const [tex,glass]=this.balconyOf(d);
      const depth=6+d.r(153)*3,drop=3.5+d.r(154)*2;
      const lit=this.relight(tex,d,on,true,glass,g.getTransform().a),masonry=this.wallTextures[hash(d.x,d.y,155)%this.wallTextures.length];
      // Contain the entire balcony. No cover crop may cut through a frame or pane.
      const ratio=tex.width/tex.height,h=Math.min(d.open?151:169,210/ratio),w=h*ratio;
      const x=(W-w-depth)/2,y=d.open?39:24;
      const sourceW=lit.width,sourceH=lit.height,sourceX=0,sourceY=0;
      const rail=d.open?(glass?glass[3]+.035:.58):0,projectionY=y+h*rail,projectionH=h*(1-rail);
      this.runoff(g,d,x+5,y+h+drop,w-7,18,.17);
      g.save();const s=g.getTransform().a;
      // Directional cast shadow plus a tight contact shadow at the wall.
      g.shadowColor='#07101780';g.shadowBlur=7*s;g.shadowOffsetX=6*s;g.shadowOffsetY=9*s;
      g.fillStyle='#253039';g.fillRect(x+3,projectionY+3,w,projectionH);g.restore();
      const contact=g.createLinearGradient(0,y+h,0,y+h+drop+14);
      contact.addColorStop(0,'#09131c80');contact.addColorStop(.55,'#09131c30');contact.addColorStop(1,'#09131c00');
      g.fillStyle=contact;g.fillRect(x+7,y+h,w+depth,drop+14);
      // Open balconies project only at the parapet; their windows stay in the wall.
      // The side uses the same photographed cladding as the front, with shared seams.
      this.texturedPlane(g,lit,[[x+w,projectionY],[x+w+depth,projectionY+drop],[x+w+depth,y+h+drop],[x+w,y+h]],.35,[sourceX+sourceW*.95,sourceY+sourceH*rail,sourceW*.05,sourceH*(1-rail)]);
      this.texturedPlane(g,masonry,[[x,y+h-.4],[x+w,y+h-.4],[x+w+depth,y+h+drop],[x+depth,y+h+drop]],.55);
      // The complete photograph and its glazing mask use the very same transform.
      g.drawImage(lit,sourceX,sourceY,sourceW,sourceH,x,y,w,h);
      // Retain the irregular photographed slab edge instead of adding a clean trim.
      const edge=g.createLinearGradient(x+w-4,0,x+w+1,0);edge.addColorStop(0,'#0b151d00');edge.addColorStop(1,'#0b151d40');
      g.fillStyle=edge;g.fillRect(x+w-4,projectionY,5,projectionH);
      if(on)this.glow(g,d,x,y,w,h,.13);
      if(d.garland)this.garland(g,d,x+12,y+h*.51,w-24,10,on);
    }
    relight(texture,d,on,balcony,glass,scale=1) {
      // Keep at least two source pixels per screen pixel at distant scales;
      // inspection zoom always uses the complete photograph and its pane mask.
      const detail=scale<=.125?.25:scale<=.25?.5:1;
      const tint=d.purple?'purple':d.cool?'cool':`warm${Math.floor(d.r(84)*3)}`;
      // Look up the finished light before creating any intermediate mipmap.
      // Variant identities survive LRU eviction and reconstruction.
      const key=this.textureId(texture)+':'+detail+':'+(on?tint:'off');
      if(this.lightCache.has(key)){const c=this.lightCache.get(key);this.lightCache.delete(key);this.lightCache.set(key,c);return c;}
      if(detail<1){const original=texture;texture=this.variant(`mip:${this.textureId(original)}:${detail}`,()=>{
        const c=this.canvas(Math.max(1,Math.round(original.width*detail)),Math.max(1,Math.round(original.height*detail))),g=c.getContext('2d');
        g.imageSmoothingQuality='high';g.drawImage(original,0,0,c.width,c.height);
        return this.registerGlass(c,this.glassMasks.get(original).panes);
      });}
      const w=texture.width,h=texture.height,c=this.canvas(w,h),g=c.getContext('2d',{willReadFrequently:true});
      // Each photograph is read back once; every light of it starts from that copy, since a
      // readback waits for all queued drawing. The photograph is still drawn first: Chrome
      // samples a canvas filled only by putImageData differently when it is scaled into a tile.
      const kept=this.sourcePixels.get(texture);let a;g.drawImage(texture,0,0);
      if(kept){a=g.createImageData(w,h);a.data.set(kept);}
      else{a=g.getImageData(0,0,w,h);this.sourcePixels.set(texture,a.data.slice());}
      const p=a.data;
      const warm=d.purple?[240,134,246]:d.cool?[238,246,225]:[255,206+Math.floor(d.r(84)*3)*10,123+Math.floor(d.r(84)*3)*9];
      const glazing=this.glassMasks.get(texture);
      if(!glazing)throw Error('Missing pane mask for photographic asset');
      const cr=on?warm[0]:143,cg=on?warm[1]:165,cb=on?warm[2]:183,maskPixels=glazing.pixels;
      for(let k=0;k<w*h;k++){
        const i=k*4,r=p[i],green=p[i+1],b=p[i+2],gray=r*.26+green*.57+b*.17,lum=gray/255;
        const mask=maskPixels[k]/255,exteriorWeight=1-mask;
        const frameScale=lum>.46?(.46+(lum-.46)*.60)/lum:1;
        let light=0;
        if(mask){const raw=.17+Math.sqrt(lum)*.93;light=on?(raw>.82?.82+(raw-.82)/(1+(raw-.82)*2.4):raw):.055+lum*.29;}
        const photo=on?mask*.13:0,f=frameScale*exteriorWeight;
        p[i]=(gray+(r-gray)*.62)*.74*f+cr*light*mask+(r-gray)*photo;
        p[i+1]=(gray+(green-gray)*.62)*.755*f+cg*light*mask+(green-gray)*photo;
        p[i+2]=(gray+(b-gray)*.62)*.76*f+cb*light*mask+(b-gray)*photo;
      }
      g.putImageData(a,0,0);this.lightCache.set(key,c);this.lightBytes+=w*h*4;
      while(this.lightBytes>this.lightBudget&&this.lightCache.size>1){const k=this.lightCache.keys().next().value;const old=this.lightCache.get(k);this.lightCache.delete(k);this.lightBytes-=old.width*old.height*4;old.width=1;old.height=1;}
      return c;
    }
    drawAircon(g,d) {
      const i=hash(d.x,d.y,76)%this.aircons.length;
      const ac=this.aircons[i],w=44,h=w*ac.height/ac.width;
      const x=d.r(77)<.5?26:W-68,y=164+d.r(78)*9,s=g.getTransform().a;
      g.save();g.shadowColor='#0b1117a0';g.shadowBlur=2.5*s;g.shadowOffsetX=1.2*s;g.shadowOffsetY=3*s;
      g.drawImage(ac,x,y,w,h);g.restore();
    }
    drawCable(g,d) {
      const x=16+d.r(80)*15;g.save();g.strokeStyle='#202a30b3';g.lineWidth=.7;g.beginPath();g.moveTo(x,0);g.bezierCurveTo(x-8,H*.22,x+13,H*.72,x+3,H);g.stroke();g.restore();
    }
    garland(g,d,x,y,w,h,on) {
      g.save();g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+w/2,y+18,x+w,y);g.strokeStyle='#172332a0';g.lineWidth=.7;g.stroke();
      const colors=['#e9b876','#b8c9b1','#c39680','#d7cdb1'];
      for(let i=0;i<11;i++) {const t=i/10,yy=y+18*2*t*(1-t);g.fillStyle=on?colors[i%4]:'#959381';g.shadowColor=on?colors[i%4]:'transparent';g.shadowBlur=on?4*g.getTransform().a:0;g.fillRect(x+t*w,yy,1.5,2.4);}g.restore();
    }
  }

  // Device pixels per facade unit. Every level has whole-pixel apartments.
  const LEVELS=[.03125,.0625,.125,.1875,.25,.375,.5,.75,1,1.25,1.5,2,3,4];
  const EMPTY=0,OFF=2,ON=3,STALE=4;
  const fresh=s=>s===OFF||s===ON;
  // The browser composites finished tiles. Panning and zooming within a detail level only
  // move DOM layers; canvas pixels are painted once, when an apartment is first needed or its
  // light changes. The picture on screen is always complete: apartments are prepared ahead of
  // the camera, and one that is not ready when it comes into view is painted before that frame.
  class Surface {
    constructor(renderer,root,options={}) {
      this.renderer=renderer;this.root=root;
      this.budget=options.budget||256*1024*1024;this.maxResolution=options.maxResolution||4;
      this.layers=new Map();this.display=null;this.target=null;this.over=null;this.bytes=0;this.frame=0;this.stepCost=2;
      this.shown=false;this.moved=0;this.zoomed=0;this.camera=null;this.heading={x:0,y:0};
      this.interval=1000/60;this.recent=new Float64Array(60);this.count=0;this.last=0;this.share=.4;this.worked=false;
    }
    fits(view,s) {
      // On large displays keep the visible frame, at two levels during a zoom, inside the budget.
      const {width,height,zoom}=view,cells=(width/(W*zoom)+1)*(height/(H*zoom)+1);
      return cells*W*H*s*s*4<=this.budget*.35;
    }
    level(view) {
      const {zoom,dpr}=view;
      let i=LEVELS.findIndex(s=>s>=Math.min(zoom*dpr,this.maxResolution));if(i<0)i=LEVELS.length-1;
      while(i>0&&!this.fits(view,LEVELS[i]))i--;
      // A slight zoom out keeps the current level, reduced by the compositor down to .7 of its
      // resolution, instead of repainting every apartment on screen at the level below.
      const current=this.display&&this.display.s;
      return current>LEVELS[i]&&zoom*dpr>=current*.7&&this.fits(view,current)?current:LEVELS[i];
    }
    layer(s,view) {
      let layer=this.layers.get(s);
      if(!layer){
        const el=document.createElement('div');el.className='layer';
        // Large apartments are prepared ahead in bands of about 110k pixels, one band per step.
        const bands=Math.max(1,Math.ceil(W*s*H*s/110000));
        layer={s,cw:W*s,ch:H*s,n:clamp(Math.floor(512/Math.max(W*s,H*s)),1,16),bands,band:Math.ceil(H*s/bands),tiles:new Map(),attached:new Set(),el,ox:0,oy:0,transform:''};
        this.rebase(layer,view);this.layers.set(s,layer);
      }
      return layer;
    }
    rebase(layer,view) {
      // CSS positions stay small next to the camera, even two billion apartments away.
      layer.ox=Math.floor(view.cx/W);layer.oy=Math.floor(view.cy/H);
      for(const t of layer.tiles.values())this.place(t);
    }
    place(t) {
      const l=t.layer,dpr=this.renderer.dpr;
      t.canvas.style.left=(t.tx*l.n-l.ox)*l.cw/dpr+'px';t.canvas.style.top=(t.ty*l.n-l.oy)*l.ch/dpr+'px';
    }
    tile(layer,tx,ty) {
      const key=tx+','+ty;let t=layer.tiles.get(key);
      if(!t){
        const n=layer.n,dpr=this.renderer.dpr,c=this.renderer.canvas(n*layer.cw,n*layer.ch);
        c.style.width=c.width/dpr+'px';c.style.height=c.height/dpr+'px';
        t={layer,tx,ty,key,canvas:c,g:c.getContext('2d'),states:new Uint8Array(n*n),todo:n*n,used:this.frame};
        layer.tiles.set(key,t);this.place(t);layer.el.appendChild(c);layer.attached.add(t);this.bytes+=c.width*c.height*4;
      }
      return t;
    }
    cellState(layer,x,y) {
      const n=layer.n,t=layer.tiles.get(Math.floor(x/n)+','+Math.floor(y/n));
      return t?t.states[(y-t.ty*n)*n+x-t.tx*n]:EMPTY;
    }
    prepare(layer,x,y,state) {
      const s=this.cellState(layer,x,y);if(fresh(s))return;
      const d=describe(x,y),on=state(d);
      if(!(s&STALE)||(s&3)!==(on?ON:OFF))this.renderer.prepareCell(d,on,layer.s);
    }
    settle(layer,x,y,state,whole) {
      // One step towards showing the current light of this apartment: the whole
      // apartment, or the next band of a large one.
      const n=layer.n,t=this.tile(layer,Math.floor(x/n),Math.floor(y/n)),i=(y-t.ty*n)*n+x-t.tx*n,was=t.states[i];
      if(fresh(was))return true;
      const d=describe(x,y),want=state(d)?ON:OFF;
      if((was&STALE)&&(was&3)===want){t.states[i]=want;t.todo--;return true;}
      const px=(i%n)*layer.cw,py=Math.floor(i/n)*layer.ch,part=t.partial&&t.partial.get(i);
      const first=part&&part.want===want?part.band:0,last=whole?layer.bands:first+1;
      this.renderer.paintCell(t.g,d,want===ON,layer.s,px,py,first*layer.band,Math.min(layer.ch,last*layer.band));
      if(last<layer.bands){(t.partial||(t.partial=new Map())).set(i,{band:last,want});return false;}
      if(part)t.partial.delete(i);
      t.todo--;t.states[i]=want;return true;
    }
    uncover(x,y) {
      // An out-of-date apartment on the level kept on top gives way to the level beneath.
      const l=this.over,n=l.n,t=l.tiles.get(Math.floor(x/n)+','+Math.floor(y/n));if(!t)return;
      const i=(y-t.ty*n)*n+x-t.tx*n;
      t.g.save();t.g.setTransform(1,0,0,1,0,0);t.g.clearRect((i%n)*l.cw,Math.floor(i/n)*l.ch,l.cw,l.ch);t.g.restore();
      t.states[i]=EMPTY;if(t.partial)t.partial.delete(i);
    }
    complete(layer,box,state) {
      const cells=this.pending(layer,box,0,0);
      for(const {x,y} of cells)this.prepare(layer,x,y,state);
      for(const {x,y} of cells)this.settle(layer,x,y,state,true);
    }
    mark(layer,x,y) {
      const n=layer.n,t=layer.tiles.get(Math.floor(x/n)+','+Math.floor(y/n));if(!t)return;
      const i=(y-t.ty*n)*n+x-t.tx*n,s=t.states[i];
      if(fresh(s)){t.states[i]=s|STALE;t.todo++;}
    }
    invalidate(x,y) {
      // The apartment is repainted before the next frame if it is on screen, later otherwise.
      for(const layer of this.layers.values())this.mark(layer,x,y);
    }
    reset() {
      // Every light may have changed (local <-> shared field): each apartment is rechecked
      // before it is shown again.
      for(const layer of this.layers.values())for(const t of layer.tiles.values())
        for(let i=0;i<t.states.length;i++)if(fresh(t.states[i])){t.states[i]|=STALE;t.todo++;}
    }
    pending(layer,box,cx,cy) {
      // Apartments of the box whose pixels in this layer are missing or out of date, nearest first.
      const n=layer.n,list=[];
      for(let ty=Math.floor(box.y0/n);ty<=Math.floor(box.y1/n);ty++)for(let tx=Math.floor(box.x0/n);tx<=Math.floor(box.x1/n);tx++){
        const t=layer.tiles.get(tx+','+ty);if(t&&!t.todo)continue;
        const xa=Math.max(box.x0,tx*n),xb=Math.min(box.x1,tx*n+n-1),ya=Math.max(box.y0,ty*n),yb=Math.min(box.y1,ty*n+n-1);
        for(let y=ya;y<=yb;y++)for(let x=xa;x<=xb;x++){
          if(box.skip&&x>=box.skip.x0&&x<=box.skip.x1&&y>=box.skip.y0&&y<=box.skip.y1)continue;
          if(t&&fresh(t.states[(y-ty*n)*n+x-tx*n]))continue;
          const dx=(x+.5)*W-cx,dy=(y+.5)*H-cy;list.push({x,y,d:dx*dx+dy*dy});
        }
      }
      return list.sort((a,b)=>a.d-b.d);
    }
    sync(layer,box) {
      const n=layer.n,tx0=Math.floor(box.x0/n),tx1=Math.floor(box.x1/n),ty0=Math.floor(box.y0/n),ty1=Math.floor(box.y1/n);
      for(const t of layer.attached)if(t.tx<tx0||t.tx>tx1||t.ty<ty0||t.ty>ty1){t.canvas.remove();layer.attached.delete(t);}
      for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){
        const t=layer.tiles.get(tx+','+ty);if(!t)continue;
        t.used=this.frame;if(!layer.attached.has(t)){layer.el.appendChild(t.canvas);layer.attached.add(t);}
      }
    }
    position(layer,view,left,top) {
      const {zoom,dpr}=view;
      if(Math.abs(view.cx/W-layer.ox)>1e3||Math.abs(view.cy/H-layer.oy)>1e3)this.rebase(layer,view);
      // Whole device pixels keep a still image crisp; the scale is the rest of the zoom.
      const x=Math.round((layer.ox*W-left)*zoom*dpr)/dpr,y=Math.round((layer.oy*H-top)*zoom*dpr)/dpr;
      const transform=`translate(${x}px,${y}px) scale(${zoom*dpr/layer.s})`;
      if(transform!==layer.transform){layer.el.style.transform=transform;layer.transform=transform;}
    }
    arrange() {
      // The displayed level, and during a zoom out the previous level on top of it; a level
      // being prepared waits off the page.
      const want=this.shown?[this.display,this.over].filter(Boolean):[];
      for(const layer of this.layers.values())if(layer.el.parentNode&&!want.includes(layer))layer.el.remove();
      let prev=null;
      for(const layer of want){const after=prev?prev.nextSibling:this.root.firstChild;if(layer.el!==after)this.root.insertBefore(layer.el,after);prev=layer.el;}
    }
    drop(t) {
      const l=t.layer;t.canvas.remove();l.attached.delete(t);l.tiles.delete(t.key);
      this.bytes-=t.canvas.width*t.canvas.height*4;t.canvas.width=0;t.canvas.height=0;
    }
    evict() {
      if(this.bytes<=this.budget)return;
      const spare=[];
      for(const layer of this.layers.values()){const live=layer===this.display||layer===this.target||layer===this.over;for(const t of layer.tiles.values())if(!live||!layer.attached.has(t))spare.push(t);}
      spare.sort((a,b)=>a.used-b.used);
      for(const t of spare){if(this.bytes<=this.budget*.9)break;this.drop(t);}
      for(const [s,layer]of this.layers)if(!layer.tiles.size&&layer!==this.display&&layer!==this.target&&layer!==this.over){layer.el.remove();this.layers.delete(s);}
    }
    clear(dpr) {
      // Tile sizes and grain are tied to the pixel density.
      for(const layer of this.layers.values()){for(const t of [...layer.tiles.values()])this.drop(t);layer.el.remove();}
      this.layers.clear();this.display=this.target=this.over=null;this.renderer.dpr=dpr;
    }
    reach(view,dx,dy) {
      // The share of a programmatic move (an inertial fling) that keeps every apartment in the
      // frame among those already prepared: such a move never has to wait for painting.
      const layer=this.display;if(!this.shown||!layer)return 1;
      const frame=v=>{const left=v.cx-v.width/(2*v.zoom),top=v.cy-v.height/(2*v.zoom);return{x0:Math.floor(left/W),x1:Math.floor((left+v.width/v.zoom)/W),y0:Math.floor(top/H),y1:Math.floor((top+v.height/v.zoom)/H)};};
      const now=frame(view),painted=(l,x,y)=>l&&(this.cellState(l,x,y)&3)>=OFF;
      const ready=t=>{
        const b=frame({width:view.width,height:view.height,zoom:view.zoom,cx:view.cx+dx*t,cy:view.cy+dy*t});
        for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++){
          if(x>=now.x0&&x<=now.x1&&y>=now.y0&&y<=now.y1)continue;
          if(!painted(layer,x,y)&&!painted(this.over,x,y))return false;
        }
        return true;
      };
      if(ready(1))return 1;
      let lo=0,hi=1;for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(ready(mid))lo=mid;else hi=mid;}
      return lo;
    }
    ahead(box,layer) {
      // Apartments prepared around the frame: a margin on every side and more in the direction
      // of travel, as much as the tile budget allows.
      const cols=box.x1-box.x0+1,rows=box.y1-box.y0+1,{x:hx,y:hy}=this.heading,cell=layer.cw*layer.ch*4;
      for(let f=1;;f*=.8){
        const mx=Math.max(1,Math.round(clamp(Math.ceil(cols*.3),2,10)*f)),my=Math.max(1,Math.round(clamp(Math.ceil(rows*.25),2,8)*f));
        const ax=Math.round(clamp(Math.ceil(cols*.5),3,14)*f),ay=Math.round(clamp(Math.ceil(rows*.4),3,12)*f);
        const near={x0:box.x0-mx-(hx<0?ax:0),x1:box.x1+mx+(hx>0?ax:0),y0:box.y0-my-(hy<0?ay:0),y1:box.y1+my+(hy>0?ay:0),skip:box};
        if((near.x1-near.x0+1)*(near.y1-near.y0+1)*cell<=this.budget*.55||f<.2)return near;
      }
    }
    update(view,state,now=performance.now()) {
      const {width,height,zoom,cx,cy,dpr}=view,start=performance.now();
      if(dpr!==this.renderer.dpr)this.clear(dpr);
      this.frame++;
      // The share of a frame given to preparing ahead follows what the device really manages:
      // canvas rasterization may happen after the script, so frame lengths are the measure. The
      // refresh rate itself can change (ProMotion, Low Power Mode), so the frame interval is the
      // shortest of the last 60 frames.
      const dt=now-this.last;
      if(this.last&&dt>4&&dt<100){
        this.recent[this.count++%60]=dt;
        let shortest=Infinity;for(const v of this.recent)if(v&&v<shortest)shortest=v;
        this.interval=Math.max(1000/144,shortest);
        if(this.worked)this.share=dt>this.interval*1.6?Math.max(.12,this.share*.8):Math.min(.6,this.share+.01);
      }
      this.last=now;
      const c=this.camera;
      if(!c||c.cx!==cx||c.cy!==cy||c.zoom!==zoom||c.width!==width||c.height!==height){
        if(c&&(c.cx!==cx||c.cy!==cy))this.heading={x:Math.sign(cx-c.cx),y:Math.sign(cy-c.cy)};
        if(c){this.moved=now;if(c.zoom!==zoom)this.zoomed=now;}this.camera={cx,cy,zoom,width,height};
      }
      const left=cx-width/(2*zoom),top=cy-height/(2*zoom);
      const box={x0:Math.floor(left/W),x1:Math.floor((left+width/zoom)/W),y0:Math.floor(top/H),y1:Math.floor((top+height/zoom)/H)};
      // While a zoom-in continues, the current level is magnified up to twice by the
      // compositor instead of preparing every intermediate level along the way.
      const target=this.level(view);let shown=this.display;
      const hold=!!shown&&target>shown.s&&now-this.zoomed<150&&zoom*dpr<=shown.s*2;
      const next=hold?shown:this.layer(target,view);
      if(!shown)shown=this.display=next;
      else if(next.s<shown.s){
        // Zooming out, the current level stays on top, reduced by the compositor, and only the
        // apartments it does not show are painted at once, at the new level beneath it.
        if(!this.over&&this.fits(view,shown.s))this.over=shown;
        shown=this.display=next;
      }else if(this.over&&next!==shown){
        // Zooming in again before the level beneath was complete: complete it first.
        this.complete(shown,box,state);this.over=null;
      }
      // Zooming in, the current level stays magnified on screen until the new one is complete.
      this.target=next;
      const near=this.ahead(box,shown);
      // Phase one reads every pixel this frame needs, before anything is drawn; phase two draws.
      const must=[];
      if(this.shown)for(const cell of this.pending(shown,box,cx,cy)){
        if(this.over){const s=this.cellState(this.over,cell.x,cell.y);if(fresh(s))continue;if(s!==EMPTY)this.uncover(cell.x,cell.y);}
        must.push(cell);
      }
      // The first picture covers the frame and one ring around it; the rest follows at once.
      const reveal={x0:box.x0-1,x1:box.x1+1,y0:box.y0-1,y1:box.y1+1};
      const [layer,todo]=!this.shown?[shown,this.pending(shown,reveal,cx,cy)]:this.over?[shown,this.pending(shown,box,cx,cy)]:next!==shown?[next,this.pending(next,box,cx,cy)]:[shown,this.pending(shown,near,cx,cy)];
      const budget=!this.shown?48:clamp(this.interval*this.share*(now-this.moved<250?1:1.5),1.5,12),deadline=start+budget;
      for(const {x,y} of must)this.prepare(shown,x,y,state);
      let planned=0;
      while(planned<todo.length&&(!planned||performance.now()+this.stepCost*layer.bands*(planned+1)<=deadline))this.prepare(layer,todo[planned].x,todo[planned++].y,state);
      for(const {x,y} of must)this.settle(shown,x,y,state,true);
      const paint=performance.now();let steps=0,done=0;
      for(;done<planned;done++){
        let complete=false;
        while(!(complete=this.settle(layer,todo[done].x,todo[done].y,state))&&performance.now()<=deadline)steps++;
        steps++;if(!complete||performance.now()>deadline){if(complete)done++;break;}
      }
      if(steps)this.stepCost=this.stepCost*.8+(performance.now()-paint)/steps*.2;
      const rest=todo.length-done;
      if(!rest){
        if(!this.shown)this.shown=true;
        else if(this.over)this.over=null;
        else if(next!==shown)shown=this.display=next;
      }
      this.sync(shown,this.shown?near:reveal);this.position(shown,view,left,top);
      if(this.over){this.sync(this.over,box);this.position(this.over,view,left,top);}
      if(next!==shown){this.sync(next,box);this.position(next,view,left,top);}
      this.arrange();this.evict();
      this.worked=this.shown&&!must.length&&steps>0;
      return !this.shown||rest>0||next!==shown||hold||!!this.over;
    }
  }
  root.Pole={W,H,WORLD,hash,random,describe,Renderer,Surface,clamp};
})(typeof module!=='undefined'?module.exports:window);
