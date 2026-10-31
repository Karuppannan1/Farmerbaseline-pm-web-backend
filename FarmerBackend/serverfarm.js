const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();
app.use(cors());
require('dotenv').config(); 

const NodeCache = require('node-cache');


const cache = new NodeCache({ 
  stdTTL: 300,        // 5 minutes
  checkperiod: 60,    // Check for expired entries every 60 seconds
  useClones: false    // Better performance for large objects
});


// const port = 5000;
const port = process.env.PORT || 5002;

app.use(bodyParser.json()); // <--- ADD THIS LINE HERE!


const pool = mysql.createPool({
connectionLimit: process.env.DB_CONNECTION_LIMIT || 20, // Adjust as needed
host: process.env.DB_HOST,
user: process.env.DB_USER,
database: process.env.DB_DATABASE,
password: process.env.DB_PASSWORD

});

const poolPromise = pool.promise();




const enrollmentRoutes = require('./enrollmentRoutes')(pool, poolPromise, cache);
app.use('/api/enrollment', enrollmentRoutes);



const membersRoutes = require('./membersRoutes')(pool, poolPromise, cache);
app.use('/api/members', membersRoutes);




//testing

app.get('/api/farmers/enriched', async (req, res) => {
  try {
    // Check cache first (remove this if you want real-time data)
    const cachedData = dataCache.get('enriched_farmers');
    if (cachedData) {
      console.log('Serving from cache');
      return res.json(cachedData);
    }

    console.time('enriched-farmers-query');
    
    // Single query with ALL joins - no separate API calls needed
    const query = `
      SELECT 
        m.*,
        s.state_sname,
        d.district_dname,
        l.location_lname,
        c.cluster_cname,
        g.group_cname,
        cm1.cname as cropname1,
        cv1.cvariety as variety1,
        csv1.subvariety as subvariety1,
        cm2.cname as cropname2,
        cv2.cvariety as variety2,
        csv2.subvariety as subvariety2,
        cm3.cname as cropname3,
        cv3.cvariety as variety3,
        csv3.subvariety as subvariety3,
        cm.cname as cropname,
        cv.cvariety as variety,
        csv.subvariety as subvariety,
        acm.acname as cropname6,
        acv.acvariety as variety6,
        acsv.asubvariety as subvariety6
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      LEFT JOIN cropmaster1 cm1 ON m.ccode1 = cm1.ccode1
      LEFT JOIN cropvariety1 cv1 ON m.ccode1 = cv1.ccode1 AND m.v_id1 = cv1.v_id1
      LEFT JOIN cropsubvariety1 csv1 ON m.sv_id1 = csv1.sv_id1
      LEFT JOIN cropmaster2 cm2 ON m.ccode2 = cm2.ccode2
      LEFT JOIN cropvariety2 cv2 ON m.ccode2 = cv2.ccode2 AND m.v_id2 = cv2.v_id2
      LEFT JOIN cropsubvariety2 csv2 ON m.sv_id2 = csv2.sv_id2
      LEFT JOIN cropmaster3 cm3 ON m.ccode3 = cm3.ccode3
      LEFT JOIN cropvariety3 cv3 ON m.ccode3 = cv3.ccode3 AND m.v_id3 = cv3.v_id3
      LEFT JOIN cropsubvariety3 csv3 ON m.sv_id3 = csv3.sv_id3
      LEFT JOIN cropmaster cm ON m.ccode = cm.ccode
      LEFT JOIN cropvariety cv ON m.ccode = cv.ccode AND m.v_id = cv.v_id
      LEFT JOIN cropsubvariety csv ON m.sv_id = csv.sv_id
      LEFT JOIN addcropmaster acm ON m.accode = acm.accode
      LEFT JOIN addcropvariety acv ON m.accode = acv.accode AND m.av_id = acv.av_id
      LEFT JOIN addcropsubvariety acsv ON m.asv_id = acsv.asv_id
      ORDER BY m.id
    `;
    
    const [results] = await pool.promise().query(query);
    console.timeEnd('enriched-farmers-query');
    
    console.log(`Enriched ${results.length} records with all lookup data`);
    
    // Add sno (serial number) to each record
    const dataWithSno = results.map((row, index) => ({
      ...row,
      sno: index + 1
    }));
    
    // Store in cache (remove if you want real-time data)
    dataCache.set('enriched_farmers', dataWithSno);
    
    res.json(dataWithSno);
    
  } catch (error) {
    console.error('Enriched farmers error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});


app.get('/api/farmers/paginated', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  
  console.time(`paginated-farmers-${page}-${limit}`);
  
  // Get minimal fields only for table view
  const query = `
    SELECT 
      id, farmerName, gender, age, state_scode, district_dcode,
      isMemberinFPO, mgnrega, irrigationType,
      totalAcresinTankfed, totalAcresinRainfed, 
      totalAcresinBorewell, totalAcresinDripOpenWellCanalIrrigation,
      NoofLivestockCow, NoofLivestockBuffalow, NoofLivestockGoat, NoofLivestockSheep,
      lastyearyields1, lastyearyields2, lastyearyields3
    FROM myfarmers_data 
    LIMIT ? OFFSET ?
  `;
  
  pool.query(query, [limit, offset], (err, results) => {
    if (err) {
      console.error('Paginated farmers error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Get total count in parallel
    pool.query('SELECT COUNT(*) as total FROM myfarmers_data', (err2, countResult) => {
      console.timeEnd(`paginated-farmers-${page}-${limit}`);
      
      if (err2) {
        console.error('Count error:', err2);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        data: results,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      });
    });
  });
});



app.get('/api/districts-with-counts', (req, res) => {
    const { state_scode } = req.query;

    const sql = `
        SELECT
            d.district_dcode,
            d.district_dname,
            COUNT(m.id) AS memberCount,
            COUNT(DISTINCT l.location_lcode) AS locationCount
        FROM district d
        LEFT JOIN location l
            ON l.district_dcode = d.district_dcode
        LEFT JOIN myfarmers_data m
            ON m.district_dcode = d.district_dcode
        WHERE d.state_scode = ?
        GROUP BY d.district_dcode,d.district_dname
        ORDER BY d.district_dname
    `;

    pool.query(sql,[state_scode],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });
});

app.get('/api/locations-with-counts', (req,res)=>{

    const { district_dcode } = req.query;

    const sql = `
        SELECT
            l.location_lcode,
            l.location_lname,
            COUNT(m.id) memberCount,
            COUNT(DISTINCT c.cluster_ccode) clusterCount
        FROM location l
        LEFT JOIN cluster c
            ON c.location_lcode=l.location_lcode
        LEFT JOIN myfarmers_data m
            ON m.location_lcode=l.location_lcode
        WHERE l.district_dcode=?
        GROUP BY l.location_lcode,l.location_lname
        ORDER BY l.location_lname
    `;

    pool.query(sql,[district_dcode],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });

});

app.get('/api/clusters-with-counts',(req,res)=>{

    const { location_lcode } = req.query;

    const sql=`
        SELECT
            c.cluster_ccode,
            c.cluster_cname,
            COUNT(m.id) memberCount,
            COUNT(DISTINCT g.group_gcode) groupCount
        FROM cluster c
        LEFT JOIN grp g
            ON g.cluster_ccode=c.cluster_ccode
        LEFT JOIN myfarmers_data m
            ON m.cluster_ccode=c.cluster_ccode
        WHERE c.location_lcode=?
        GROUP BY c.cluster_ccode,c.cluster_cname
        ORDER BY c.cluster_cname
    `;

    pool.query(sql,[location_lcode],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });

});

app.get('/api/groups-with-counts',(req,res)=>{

    const { cluster_ccode } = req.query;

    const sql=`
        SELECT
            g.group_gcode,
            g.group_cname,
            COUNT(m.id) memberCount
        FROM grp g
        LEFT JOIN myfarmers_data m
            ON m.group_gcode=g.group_gcode
        WHERE g.cluster_ccode=?
        GROUP BY g.group_gcode,g.group_cname
        ORDER BY g.group_cname
    `;

    pool.query(sql,[cluster_ccode],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });

});

app.get('/api/group-members',(req,res)=>{

    const { group_gcode } = req.query;

    const sql=`
        SELECT *
        FROM myfarmers_data
        WHERE group_gcode=?
        ORDER BY farmerName
    `;

    pool.query(sql,[group_gcode],(err,result)=>{
        if(err) return res.status(500).json(err);
        res.json(result);
    });

});


// Login API Endpoint
app.post('/api/login', (req, res) => {
  // Now req.body should be correctly populated by bodyParser.json()
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  // Query to check credentials against websitelogin table
  const query = 'SELECT * FROM websitelogin WHERE username = ? AND password = ?';
  pool.query(query, [username, password], (err, results) => {
    if (err) {
      console.error('Database query error:', err);
      // Send a more generic error to the client for security
      return res.status(500).json({ success: false, message: 'Server error during login verification.' });
    }

    if (results.length > 0) {
      // User found, login successful
      res.json({ success: true, message: 'Login successful' });
    } else {
      // No user found with those credentials
      res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
  });
});



/*
app.get('/api/user', (req, res) => {
  const query = 'SELECT * FROM myfarmers_data';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});
*/

app.get('/api/state', (req, res) => {
  const query = 'SELECT * FROM state';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/district', (req, res) => {
  const { state_scode } = req.query;
//  console.log('State Code:', state_scode);
  const query = 'SELECT * FROM district WHERE state_scode = ?';
  pool.query(query, [state_scode], (err, results) => {
    if (err) {
      console.error('Error fetching districts data:', err);
      res.status(500).json({ error: 'Error fetching districts data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/location', (req, res) => {
  const { district_dcode } = req.query;
//  console.log('district_dcode', district_dcode);
  const query = 'SELECT * FROM location WHERE district_dcode = ?';
  pool.query(query, [district_dcode], (err, results) => {
    if (err) {
      console.error('Error fetching locations data:', err);
      res.status(500).json({ error: 'Error fetching locations data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cluster', (req, res) => {
  const { location_lcode } = req.query;
//  console.log('location_lcode', location_lcode);
  const query = 'SELECT * FROM cluster WHERE location_lcode=?';
  pool.query(query, [location_lcode], (err, results) => {
    if (err) {
      console.error('Error fetching clusters data:', err);
      res.status(500).json({ error: 'Error fetching clusters data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/grp', (req, res) => {
  const { cluster_ccode } = req.query;
 // console.log('cluster_ccode', cluster_ccode);
  const query = 'SELECT * FROM grp WHERE cluster_ccode=?';
  pool.query(query, [cluster_ccode], (err, results) => {
    if (err) {
      console.error('Error fetching groups data:', err);
      res.status(500).json({ error: 'Error fetching groups data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/members', (req, res) => {
  const { group_gcode } = req.query;
 // console.log('group_gcode', group_gcode);
  const query = 'SELECT * FROM members WHERE group_gcode=?';
  pool.query(query, [group_gcode], (err, results) => {
    if (err) {
      console.error('Error fetching members data:', err);
      res.status(500).json({ error: 'Error fetching members data' });
    } else {
      res.json(results);
    }
  });
});


app.get('/api/cropmaster', (req, res) => {
  const query = 'SELECT * FROM cropmaster';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropvariety', (req, res) => {

  const { ccode } = req.query;
  // console.log('ccode', ccode);

  const query = 'SELECT * FROM cropvariety WHERE ccode=?';
  pool.query(query, [ccode], (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
    
  });
});

app.get('/api/cropsubvariety', (req, res) => {
  const { v_id } = req.query;
  // console.log('v_id', v_id);

  const query = 'SELECT * FROM cropsubvariety WHERE v_id=?';
  pool.query(query,  [v_id],(err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});


app.get('/api/cropmaster1', (req, res) => {
  const query = 'SELECT * FROM cropmaster1';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropvariety1', (req, res) => {
  const { ccode1 } = req.query;
  // console.log('ccode1', ccode1);

  const query = 'SELECT * FROM cropvariety1 WHERE ccode1=?';
  pool.query(query, [ccode1], (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropsubvariety1', (req, res) => {
  const { v_id1 } = req.query;
  // console.log('v_id1', v_id1);

  const query = 'SELECT * FROM cropsubvariety1 WHERE v_id1=?';
  pool.query(query,  [v_id1],(err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});


app.get('/api/cropmaster2', (req, res) => {
  const query = 'SELECT * FROM cropmaster2';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropvariety2', (req, res) => {
  const { ccode2 } = req.query;
  // console.log('ccode2', ccode2);

  const query = 'SELECT * FROM cropvariety2 WHERE ccode2=?';
  pool.query(query, [ccode2], (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropsubvariety2', (req, res) => {
  const { v_id2 } = req.query;
  // console.log('v_id2', v_id2);

  const query = 'SELECT * FROM cropsubvariety2 WHERE v_id2=?';
  pool.query(query,  [v_id2],(err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});



app.get('/api/cropmaster3', (req, res) => {
  const query = 'SELECT * FROM cropmaster3';
  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropvariety3', (req, res) => {
  const { ccode3 } = req.query;
  // console.log('ccode3', ccode3);

  const query = 'SELECT * FROM cropvariety3 WHERE ccode3=?';
  pool.query(query, [ccode3], (err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else {
      res.json(results);
    }
  });
});

app.get('/api/cropsubvariety3', (req, res) => {
  const { v_id3 } = req.query;
  // console.log('v_id3', v_id3);

  const query = 'SELECT * FROM cropsubvariety3 WHERE v_id3=?';
  pool.query(query,  [v_id3],(err, results) => {
    if (err) {
      console.error('Error fetching states data:', err);
      res.status(500).json({ error: 'Error fetching states data' });
    } else { 
      res.json(results);
    }
  });
});


app.get('/api/addcropmaster', (req, res) => {
  const sql = 'SELECT accode, acname FROM addcropmaster';
  pool.query(sql, (err, result) => {
    if (err) {
      console.error('Error fetching addcropmaster:', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(result);
  });
});

app.get('/api/addcropvariety', (req, res) => {
  const { accode } = req.query;
  const sql = 'SELECT av_id, acvariety FROM addcropvariety WHERE accode = ?';
  pool.query(sql, [accode], (err, result) => {
    if (err) {
      console.error('Error fetching addcropvariety:', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(result);
  });
});

app.get('/api/addcropsubvariety', (req, res) => {
  const { av_id } = req.query;
  const sql = 'SELECT asv_id, asubvariety FROM addcropsubvariety WHERE av_id = ?';
  pool.query(sql, [av_id], (err, result) => {
    if (err) {
      console.error('Error fetching addcropsubvariety:', err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(result);
  });
});




app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let insertCount = 0;
let failedCount = 0;

// Submit API
app.post('/submit', (req, res) => {
  const formData = req.body;
//  console.log('Form data received:', formData);
 


  const sql = `INSERT INTO myfarmers_data 
  SET 
  startMonth = '${formData.startMonth}',
  endMonth = '${formData.endMonth}',
  state_scode = '${formData.state_scode}',
  district_dcode = '${formData. district_dcode}',
  location_lcode = '${formData.location_lcode}',
  
  cluster_ccode = '${formData.cluster_ccode}',
  group_gcode = '${formData. group_gcode}',
  member_mcode = '${formData.member_mcode}',
      nonmembername = '${formData.nonmembername}',
age = '${formData.age}',
 surveyno_number='${formData.surveyno_number}',
  doorNo = '${formData.doorNo}',
  street = '${formData.street}',
  category1='${formData.category1}',
  category2='${formData.category2}',
  category3='${formData.category3}',
  category4='${formData.category4}',


  aadharNumber = '${formData.aadharNumber}',
  farmerName = '${formData.farmerName}',
  spouseName = '${formData.spouseName}',
  fatherName = '${formData.fatherName}',
   mgnrega = '${formData.mgnrega}',
    stock_insurance_enrollment='${formData.stockInsuranceEnrollment}',

  datebirth = '${formData.datebirth}',
  gender='${formData.gender}',

  farmerMobile = '${formData.farmerMobile}',
  alternateNumber = '${formData.alternateNumber}',
  isMemberinFPO = '${formData.isMemberinFPO}',
  nameoftheFPO = '${formData.nameoftheFPO}',
  latitude = '${formData.latitude}',
  longitude = '${formData.longitude}',
  irrigationType = '${formData.irrigationType}',
  totalAcresinTankfed = '${formData.totalAcresinTankfed}',
  areaofCultivationinTankfed = '${formData.areaofCultivationinTankfed}',
  soilType = '${formData.soilType}',
  landownership = '${formData.landownership}',
  cultivationpractice = '${formData.cultivationpractice}',
  landposition = '${formData.landposition}',
  landtype = '${formData.landtype}',




  

  season = '${formData.season}',
  fertilizer = '${formData.fertilizer}',
  biofertilizer = '${formData.biofertilizer}',
  lastyearyields = '${formData.lastyearyields}',
  rateofsales = '${formData.rateofsales}',
  availabilityofMachinery = '${formData.availabilityofMachinery }',
  cropInsurance = '${formData.cropInsurance }',


  totalAcresinRainfed = '${formData.totalAcresinRainfed}',
  areaofCultivationinRainfed = '${formData.areaofCultivationinRainfed}',
  soilType1 = '${formData.soilType1}',
  landownership1 = '${formData.landownership1}',
  cultivationpractice1 = '${formData.cultivationpractice1}',
  landposition1 = '${formData.landposition1}',
  landtype1 = '${formData.landtype1}',

 


  ccode1  = '${formData.ccode1}',
  v_id1  = '${formData.v_id1}',
  sv_id1  = '${formData.sv_id1}',

  ccode2  = '${formData.ccode2}',
  v_id2  = '${formData.v_id2}',
  sv_id2 = '${formData.sv_id2}',

  season1 = '${formData.season1}',
  fertilizer1 = '${formData.fertilizer1}',
  biofertilizer1 = '${formData.biofertilizer1}',
  lastyearyields1 = '${formData.lastyearyields1}',
  rateofsales1 = '${formData.rateofsales1}',
  availabilityofMachinery1 = '${formData.availabilityofMachinery1 }',
  cropInsurance1 = '${formData.cropInsurance1 }',

  totalAcresinBorewell = '${formData.totalAcresinBorewell}',
  areaofCultivationinBorewell = '${formData.areaofCultivationinBorewell}',
  soilType2 = '${formData.soilType2}',
  landownership2 = '${formData.landownership2}',
  cultivationpractice2 = '${formData.cultivationpractice2}',
  landposition2 = '${formData.landposition2}',
  landtype2 = '${formData.landtype2}',


  season2= '${formData.season2}',
  fertilizer2 = '${formData.fertilizer2}',
  biofertilizer2 = '${formData.biofertilizer2}',
  lastyearyields2 = '${formData.lastyearyields2}',
  rateofsales2 = '${formData.rateofsales2}',
  availabilityofMachinery2 = '${formData.availabilityofMachinery2 }',
  cropInsurance2 = '${formData.cropInsurance2 }',

  totalAcresinDripOpenWellCanalIrrigation = '${formData.totalAcresinDripOpenWellCanalIrrigation}',
  areaofCultivationinDripOpenWellCanalIrrigation ='${formData.areaofCultivationinDripOpenWellCanalIrrigation}',
  soilType3 = '${formData.soilType3}',
  landownership3 = '${formData.landownership3}',
  cultivationpractice3 = '${formData.cultivationpractice3}',
  landposition3 = '${formData.landposition3}',
  landtype3 = '${formData.landtype3}',

  ccode3 = '${formData.ccode3}',
  v_id3 = '${formData.v_id3}',
  sv_id3 = '${formData.sv_id3}',

  ccode = '${formData.ccode}',
  v_id = '${formData.v_id}',
  sv_id = '${formData.sv_id}',

  accode = '${formData.accode}',
  av_id = '${formData.av_id}',
  asv_id = '${formData.asv_id}',


  season3 = '${formData.season3}',


  fertilizer3 = '${formData.fertilizer3}',
  biofertilizer3 = '${formData.biofertilizer3}',
  lastyearyields3 = '${formData.lastyearyields3}',
  rateofsales3 = '${formData.rateofsales3}',
  availabilityofMachinery3 = '${formData.availabilityofMachinery3 }',
  cropInsurance3 = '${formData.cropInsurance3}',

  liveStockDetails = '${formData.liveStockDetails}',
  NoofLivestockCow = '${formData.NoofLivestockCow}',
  VarietyBreadCow = '${formData.VarietyBreadCow}',
  FeedingTypeCow = '${formData.FeedingTypeCow}',
  WhetherFodderCultivatedCow = '${formData.WhetherFodderCultivatedCow}',
  NoofMilkYieldingAnimalCow = '${formData.NoofMilkYieldingAnimalCow}',
  MilkYieldDayAnimalCow ='${formData.MilkYieldDayAnimalCow}',
  FrequencyofSalesCow = '${formData.FrequencyofSalesCow}',
  AverageIncomeCow = '${formData.AverageIncomeCow}',
  NearbyVeterinaryHospitalCow = '${formData.NearbyVeterinaryHospitalCow}',
  AnyseasonaldiseaseoutbreakCow = '${formData.AnyseasonaldiseaseoutbreakCow}',
  TreatmentMethodFollowedCow = '${formData.TreatmentMethodFollowedCow}',
  NoofLivestockBuffalow = '${formData.NoofLivestockBuffalow}',
  VarietyBreadBuffalow = '${formData.VarietyBreadBuffalow}',
  FeedingTypeBuffalow = '${formData.FeedingTypeBuffalow}',
  WhetherFodderCultivatedBuffalow = '${formData.WhetherFodderCultivatedBuffalow}',
  NoofMilkYieldingAnimalBuffalow = '${formData.NoofMilkYieldingAnimalBuffalow}',
  MilkYieldDayAnimalBuffalow = '${formData.MilkYieldDayAnimalBuffalow}',
  FrequencyofSalesBuffalow = '${formData.FrequencyofSalesBuffalow}',
  AverageIncomeBuffalow = '${formData.AverageIncomeBuffalow}',
  NearbyVeterinaryHospitalBuffalow = '${formData.NearbyVeterinaryHospitalBuffalow}',
  AnyseasonaldiseaseoutbreakBuffalow = '${formData.AnyseasonaldiseaseoutbreakBuffalow}',
  TreatmentMethodFollowedBuffalow = '${formData.TreatmentMethodFollowedBuffalow}',
  NoofLivestockGoat = '${formData.NoofLivestockGoat}',
  VarietyBreadGoat = '${formData.VarietyBreadGoat}',
  FeedingTypeGoat = '${formData.FeedingTypeGoat}',
  WhetherFodderCultivatedGoat = '${formData.WhetherFodderCultivatedGoat}',
  NoofMilkYieldingAnimalGoat = '${formData.NoofMilkYieldingAnimalGoat}',
  MilkYieldDayAnimalGoat = '${formData.MilkYieldDayAnimalGoat}',
  FrequencyofSalesGoat = '${formData.FrequencyofSalesGoat}',
  AverageIncomeGoat = '${formData.AverageIncomeGoat}',
  NearbyVeterinaryHospitalGoat = '${formData.NearbyVeterinaryHospitalGoat}',
  AnyseasonaldiseaseoutbreakGoat = '${formData.AnyseasonaldiseaseoutbreakGoat}',
  TreatmentMethodFollowedGoat = '${formData.TreatmentMethodFollowedGoat}',
  NoofLivestockSheep = '${formData.NoofLivestockSheep}',
  VarietyBreadSheep = '${formData.VarietyBreadSheep}',
  FeedingTypeSheep = '${formData.FeedingTypeSheep}',
  WhetherFodderCultivatedSheep = '${formData.WhetherFodderCultivatedSheep}',
  NoofMilkYieldingAnimalSheep = '${formData.NoofMilkYieldingAnimalSheep}',
  MilkYieldDayAnimalSheep = '${formData.MilkYieldDayAnimalSheep}',
  FrequencyofSalesSheep = '${formData.FrequencyofSalesSheep}',
  AverageIncomeSheep = '${formData.AverageIncomeSheep}',
  NearbyVeterinaryHospitalSheep = '${formData.NearbyVeterinaryHospitalSheep}',
  AnyseasonaldiseaseoutbreakSheep = '${formData.AnyseasonaldiseaseoutbreakSheep}',
  TreatmentMethodFollowedSheep = '${formData.TreatmentMethodFollowedSheep}',
  LiveStockInsuranceDetails= '${formData.LiveStockInsuranceDetails}',


  LiveStockInsuranceDetailsCow20= '${formData.LiveStockInsuranceDetailsCow20}',
  LiveStockInsuranceDetailsCow21= '${formData.LiveStockInsuranceDetailsCow21}',
  LiveStockInsuranceDetailsCow22= '${formData.LiveStockInsuranceDetailsCow22}',
  LiveStockInsuranceDetailsCow23= '${formData.LiveStockInsuranceDetailsCow23}',
  LiveStockInsuranceDetailsCow24= '${formData.LiveStockInsuranceDetailsCow24}',
  LiveStockInsuranceDetailsbuffalo20= '${formData.LiveStockInsuranceDetailsbuffalo20}',
  LiveStockInsuranceDetailsbuffalo21= '${formData.LiveStockInsuranceDetailsbuffalo21}',
  LiveStockInsuranceDetailsbuffalo22= '${formData.LiveStockInsuranceDetailsbuffalo22}',
  LiveStockInsuranceDetailsbuffalo23= '${formData.LiveStockInsuranceDetailsbuffalo23}',
  LiveStockInsuranceDetailsbuffalo24= '${formData.LiveStockInsuranceDetailsbuffalo24}',



 LiveStockInsuranceDetailsgoat20= '${formData.LiveStockInsuranceDetailsgoat20}',
 LiveStockInsuranceDetailsgoat21= '${formData.LiveStockInsuranceDetailsgoat21}',
 LiveStockInsuranceDetailsgoat22= '${formData.LiveStockInsuranceDetailsgoat22}',
LiveStockInsuranceDetailsgoat23= '${formData.LiveStockInsuranceDetailsgoat23}',
LiveStockInsuranceDetailsgoat24= '${formData.LiveStockInsuranceDetailsgoat24}',


  LiveStockInsuranceDetailssheep20= '${formData.LiveStockInsuranceDetailssheep20}',
  LiveStockInsuranceDetailssheep21= '${formData.LiveStockInsuranceDetailssheep21}',
  LiveStockInsuranceDetailssheep22= '${formData.LiveStockInsuranceDetailssheep22}',
  LiveStockInsuranceDetailssheep23= '${formData.LiveStockInsuranceDetailssheep23}',
  LiveStockInsuranceDetailssheep24= '${formData.LiveStockInsuranceDetailssheep24}',

  irrigationtyperainfed='${formData.irrigationtyperainfed}',
  irrigationtypeborewell='${formData.irrigationtypeborewell}',
  irrigationtypedrip='${formData.irrigationtypedrip}',

Livestockbuffalow='${formData.Livestockbuffalow}',
Livestockgoat='${formData.Livestockgoat}',
Livestocksheep='${formData.Livestocksheep}',



  LiveStockInsuranceDetailsothers20= '${formData.LiveStockInsuranceDetailsothers20}',
  LiveStockInsuranceDetailsothers21= '${formData.LiveStockInsuranceDetailsothers21}',
  LiveStockInsuranceDetailsothers22= '${formData.LiveStockInsuranceDetailsothers22}',
LiveStockInsuranceDetailsothers23= '${formData.LiveStockInsuranceDetailsothers23}',
 LiveStockInsuranceDetailsothers24= '${formData.LiveStockInsuranceDetailsothers24}',
  
    Addseason1 = '${formData.Addseason1}',
    Addfertilizer1 = '${formData.Addfertilizer1}',
    Addbiofertilizer1 = '${formData.Addbiofertilizer1}',
    Addlastyearyields1 = '${formData.Addlastyearyields1}',
    Addrateofsales1 = '${formData.Addrateofsales1}',
    AddavailabilityofMachinery1 = '${formData.AddavailabilityofMachinery1}',
    AddcropInsurance1 = '${formData.AddcropInsurance1}';`;
 
 
/*
 pool.query(sql, formData, (err, result) => {
    if (err) {
      console.error(err);
      res.status(500).send('Error saving data');
      return;
    }
    console.log('Data added successfully');
    res.status(200).send('Data added successfully');
  });
});

*/

pool.query(sql, formData, (err, result) => {
    if (err) {
      failedCount++;
      console.error(`\n❌ Failed to insert data`);
      console.error(`🔢 Count: ${failedCount}`);
      console.error(`📦 Data: ${JSON.stringify(formData, null, 2)}`);
      console.error(`🧨 Error: ${err.message}`);
      res.status(500).send('Error saving data');
      return;
    }

    insertCount++;
    console.log(`✅ ${insertCount} data inserted successfully`);
    res.status(200).send('Data added successfully');
  });

});


// Add this to your backend
app.get('/api/user/paginated', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 100, 
      search = '', 
      state, district, location, cluster, group, memberCode, nonMemberName 
    } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = 'SELECT * FROM myfarmers_data WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM myfarmers_data WHERE 1=1';
    const params = [];
    
    // Apply filters
    if (state) {
      query += ' AND state_sname = ?';
      countQuery += ' AND state_sname = ?';
      params.push(state);
    }
    if (district) {
      query += ' AND district_name = ?';
      countQuery += ' AND district_name = ?';
      params.push(district);
    }
    if (location) {
      query += ' AND location_name = ?';
      countQuery += ' AND location_name = ?';
      params.push(location);
    }
    if (cluster) {
      query += ' AND cluster_name = ?';
      countQuery += ' AND cluster_name = ?';
      params.push(cluster);
    }
    if (group) {
      query += ' AND group_name = ?';
      countQuery += ' AND group_name = ?';
      params.push(group);
    }
    if (memberCode) {
      query += ' AND member_mcode = ?';
      countQuery += ' AND member_mcode = ?';
      params.push(memberCode);
    }
    if (nonMemberName) {
      query += ' AND nonmembername = ?';
      countQuery += ' AND nonmembername = ?';
      params.push(nonMemberName);
    }
    if (search) {
      query += ' AND (farmerName LIKE ? OR member_mcode LIKE ? OR nonmembername LIKE ? OR farmerMobile LIKE ?)';
      countQuery += ' AND (farmerName LIKE ? OR member_mcode LIKE ? OR nonmembername LIKE ? OR farmerMobile LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    query += ` ORDER BY id LIMIT ${parseInt(limit)} OFFSET ${offset}`;
    
    const [records] = await pool.execute(query, params);
    const [totalResult] = await pool.execute(countQuery, params.slice(0, params.length - (search ? 4 : 0)));
    
    res.json({
      records,
      total: totalResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: records.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Error in paginated API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export endpoint
app.get('/api/user/export', async (req, res) => {
  try {
    const { search = '', state, district, location, cluster, group, memberCode, nonMemberName } = req.query;
    
    let query = 'SELECT * FROM myfarmers_data WHERE 1=1';
    const params = [];
    
    // Apply same filters as above
    // ... (same filter logic)
    
    const [records] = await pool.execute(query, params);
    
    // Convert to CSV
    const csvHeaders = Object.keys(records[0] || {}).join(',');
    const csvRows = records.map(row => Object.values(row).map(value => 
      `"${String(value || '').replace(/"/g, '""')}"`
    ).join(','));
    
    const csv = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=farmers_export_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});



// SUPER FAST DASHBOARD ENDPOINT
app.get('/api/dashboard-fast', async (req, res) => {
  try {
    const start = Date.now();
    
    const [result] = await pool.promise().query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isMemberinFPO = 'Yes' THEN 1 ELSE 0 END) as fpo,
        SUM(CASE WHEN mgnrega = 'Yes' THEN 1 ELSE 0 END) as mgnrega,
        SUM(COALESCE(NoofLivestockCow,0) + COALESCE(NoofLivestockBuffalow,0) + 
            COALESCE(NoofLivestockGoat,0) + COALESCE(NoofLivestockSheep,0)) as totalLivestock,
        SUM(CASE WHEN irrigationType != '' OR irrigationtyperainfed != '' 
                  OR irrigationtypeborewell != '' OR irrigationtypedrip != '' 
             THEN 1 ELSE 0 END) as totalIrrigation,
        ROUND(AVG(CASE WHEN age REGEXP '^[0-9]+$' THEN CAST(age AS DECIMAL) END)) as avgAge,
        SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) as male,
        SUM(CASE WHEN gender = 'female' THEN 1 ELSE 0 END) as female
      FROM myfarmers_data
    `);
    
    const timeTaken = Date.now() - start;
    console.log(`Dashboard API: ${timeTaken}ms`);
    
    res.json(result);
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============== ADD THIS FAST DASHBOARD ENDPOINT ===============
app.get('/api/dashboard-stats', async (req, res) => {
  try {
    console.log('Dashboard stats requested...');
    
    const query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN isMemberinFPO = 'Yes' THEN 1 ELSE 0 END) as fpo,
        SUM(CASE WHEN mgnrega = 'Yes' THEN 1 ELSE 0 END) as mgnrega,
        SUM(COALESCE(NoofLivestockCow,0) + COALESCE(NoofLivestockBuffalow,0) + 
            COALESCE(NoofLivestockGoat,0) + COALESCE(NoofLivestockSheep,0)) as totalLivestock,
        SUM(CASE WHEN irrigationType != '' OR irrigationtyperainfed != '' 
                  OR irrigationtypeborewell != '' OR irrigationtypedrip != '' 
             THEN 1 ELSE 0 END) as totalIrrigationFarmers,
        ROUND(AVG(CASE WHEN age REGEXP '^[0-9]+$' AND age > 0 THEN CAST(age AS DECIMAL) END)) as avgAge,
        SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) as male,
        SUM(CASE WHEN gender = 'female' THEN 1 ELSE 0 END) as female,
        SUM(CASE WHEN gender NOT IN ('male', 'female') OR gender IS NULL THEN 1 ELSE 0 END) as other
      FROM myfarmers_data
    `;
    
    pool.query(query, (err, result) => {
      if (err) {
        console.error('Dashboard query error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      const data = result[0];
      console.log('Dashboard stats sent:', data.total, 'records');
      
      res.json({
        success: true,
        total: data.total || 0,
        fpo: data.fpo || 0,
        mgnrega: data.mgnrega || 0,
        totalLivestock: data.totalLivestock || 0,
        totalIrrigationFarmers: data.totalIrrigationFarmers || 0,
        avgAge: data.avgAge || 0,
        gender: {
          male: data.male || 0,
          female: data.female || 0,
          other: data.other || 0
        }
      });
    });
    
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});



// =============== COMPLETE DASHBOARD API - WITH FIXED AGE ===============
// =============== COMPLETE DASHBOARD API - NO RESERVED KEYWORDS ===============
// =============== COMPLETE DASHBOARD API - ALL TABS WORKING ===============
/*
app.get('/api/admin-summary', (req, res) => {
  const mainQuery = `
    SELECT 
      -- Basic counts
      COUNT(*) as total,
      SUM(CASE WHEN LOWER(isMemberinFPO) = 'yes' THEN 1 ELSE 0 END) as fpo,
      SUM(CASE WHEN LOWER(mgnrega) = 'yes' THEN 1 ELSE 0 END) as mgnrega,
      
      -- Livestock
      SUM(COALESCE(NoofLivestockCow,0) + COALESCE(NoofLivestockBuffalow,0) + 
          COALESCE(NoofLivestockGoat,0) + COALESCE(NoofLivestockSheep,0)) as totalLivestock,
      
      -- Irrigation Farmers
      SUM(CASE WHEN irrigationType != '' OR irrigationtyperainfed != '' 
                OR irrigationtypeborewell != '' OR irrigationtypedrip != '' 
           THEN 1 ELSE 0 END) as totalIrrigationFarmers,
      
      -- Average Age
      ROUND(AVG(CASE WHEN age REGEXP '^[0-9]+$' AND age > 0 AND age < 120 
                THEN CAST(age AS DECIMAL) END)) as avgAge,
      
      -- Gender
      SUM(CASE WHEN LOWER(gender) = 'male' THEN 1 ELSE 0 END) as male,
      SUM(CASE WHEN LOWER(gender) = 'female' THEN 1 ELSE 0 END) as female,
      
      -- ========== ACTIVITIES TAB ==========
      -- Farming Only (has crops, no livestock)
      SUM(CASE WHEN (ccode1 != '' OR ccode2 != '' OR ccode3 != '' OR ccode != '') 
                AND (COALESCE(NoofLivestockCow,0) = 0 AND COALESCE(NoofLivestockBuffalow,0) = 0 
                     AND COALESCE(NoofLivestockGoat,0) = 0 AND COALESCE(NoofLivestockSheep,0) = 0)
           THEN 1 ELSE 0 END) as farmingOnly,
      
      -- Livestock Only (has livestock, no crops)
      SUM(CASE WHEN (ccode1 = '' AND ccode2 = '' AND ccode3 = '' AND ccode = '') 
                AND (COALESCE(NoofLivestockCow,0) > 0 OR COALESCE(NoofLivestockBuffalow,0) > 0 
                     OR COALESCE(NoofLivestockGoat,0) > 0 OR COALESCE(NoofLivestockSheep,0) > 0)
           THEN 1 ELSE 0 END) as livestockOnly,
      
      -- Both (has crops AND livestock)
      SUM(CASE WHEN (ccode1 != '' OR ccode2 != '' OR ccode3 != '' OR ccode != '') 
                AND (COALESCE(NoofLivestockCow,0) > 0 OR COALESCE(NoofLivestockBuffalow,0) > 0 
                     OR COALESCE(NoofLivestockGoat,0) > 0 OR COALESCE(NoofLivestockSheep,0) > 0)
           THEN 1 ELSE 0 END) as bothActivities,
      
      -- Alternative Livelihoods (no crops, no livestock)
      SUM(CASE WHEN (ccode1 = '' AND ccode2 = '' AND ccode3 = '' AND ccode = '') 
                AND (COALESCE(NoofLivestockCow,0) = 0 AND COALESCE(NoofLivestockBuffalow,0) = 0 
                     AND COALESCE(NoofLivestockGoat,0) = 0 AND COALESCE(NoofLivestockSheep,0) = 0)
           THEN 1 ELSE 0 END) as alternativeLivelihoods,
      
      -- ========== IRRIGATION TYPES TAB ==========
      SUM(CASE WHEN LOWER(irrigationType) = 'tankfed' OR LOWER(irrigationtyperainfed) = 'tankfed' 
                OR LOWER(irrigationtypeborewell) = 'tankfed' OR LOWER(irrigationtypedrip) = 'tankfed'
                OR totalAcresinTankfed > 0 OR areaofCultivationinTankfed > 0
           THEN 1 ELSE 0 END) as tankfed,
      
      SUM(CASE WHEN LOWER(irrigationType) = 'rainfed' OR LOWER(irrigationtyperainfed) = 'rainfed' 
                OR LOWER(irrigationtypeborewell) = 'rainfed' OR LOWER(irrigationtypedrip) = 'rainfed'
                OR totalAcresinRainfed > 0 OR areaofCultivationinRainfed > 0
           THEN 1 ELSE 0 END) as rainfed,
      
      SUM(CASE WHEN LOWER(irrigationType) = 'borewell' OR LOWER(irrigationtyperainfed) = 'borewell' 
                OR LOWER(irrigationtypeborewell) = 'borewell' OR LOWER(irrigationtypedrip) = 'borewell'
                OR totalAcresinBorewell > 0 OR areaofCultivationinBorewell > 0
           THEN 1 ELSE 0 END) as borewell,
      
      SUM(CASE WHEN LOWER(irrigationType) = 'drip' OR LOWER(irrigationtyperainfed) = 'drip' 
                OR LOWER(irrigationtypeborewell) = 'drip' OR LOWER(irrigationtypedrip) = 'drip'
                OR totalAcresinDripOpenWellCanalIrrigation > 0 
                OR areaofCultivationinDripOpenWellCanalIrrigation > 0
           THEN 1 ELSE 0 END) as drip,
      
      -- ========== YIELD CATEGORIES TAB ==========
      SUM(CASE WHEN category1 = 'Aspirant' OR category2 = 'Aspirant' 
                OR category3 = 'Aspirant' OR category4 = 'Aspirant'
           THEN 1 ELSE 0 END) as aspirant,
      
      SUM(CASE WHEN category1 = 'Performer' OR category2 = 'Performer' 
                OR category3 = 'Performer' OR category4 = 'Performer'
           THEN 1 ELSE 0 END) as performer,
      
      SUM(CASE WHEN category1 = 'Front Runner' OR category2 = 'Front Runner' 
                OR category3 = 'Front Runner' OR category4 = 'Front Runner'
           THEN 1 ELSE 0 END) as frontRunner,
      
      SUM(CASE WHEN category1 = 'Bench Marker' OR category2 = 'Bench Marker' 
                OR category3 = 'Bench Marker' OR category4 = 'Bench Marker'
           THEN 1 ELSE 0 END) as benchMarker,
      
      SUM(CASE WHEN (category1 = '' OR category1 IS NULL) 
                AND (category2 = '' OR category2 IS NULL)
                AND (category3 = '' OR category3 IS NULL)
                AND (category4 = '' OR category4 IS NULL)
           THEN 1 ELSE 0 END) as noYield
      
    FROM myfarmers_data
  `;

  pool.query(mainQuery, (err, results) => {
    if (err) {
      console.error('Admin summary error:', err);
      return res.status(500).json({ error: err.message });
    }
    
    const data = results[0];
    
    res.json({
      success: true,
      total: data.total || 0,
      fpo: data.fpo || 0,
      mgnrega: data.mgnrega || 0,
      totalLivestock: data.totalLivestock || 0,
      totalIrrigationFarmers: data.totalIrrigationFarmers || 0,
      avgAge: data.avgAge || 0,
      
      // Activities
      farmingOnly: data.farmingOnly || 0,
      livestockOnly: data.livestockOnly || 0,
      both: data.bothActivities || 0,
      alternativeLivelihoods: data.alternativeLivelihoods || 0,
      
      // Irrigation
      tankfed: data.tankfed || 0,
      rainfed: data.rainfed || 0,
      borewell: data.borewell || 0,
      drip: data.drip || 0,
      
      // Yield
      aspirant: data.aspirant || 0,
      performer: data.performer || 0,
      frontRunner: data.frontRunner || 0,
      benchMarker: data.benchMarker || 0,
      noYield: data.noYield || 0,
      
      // Gender
      male: data.male || 0,
      female: data.female || 0,
      other: (data.total || 0) - (data.male || 0) - (data.female || 0)
    });
  });
});
*/

// =============== STATES/GEOGRAPHY API ===============
app.get('/api/dashboard/states', (req, res) => {
  const query = `
    SELECT
      s.state_scode,
      s.state_sname as name,
      COUNT(m.id) as memberCount,
      COUNT(DISTINCT m.district_dcode) as regionCount
    FROM state s
    LEFT JOIN myfarmers_data m ON s.state_scode = m.state_scode
    GROUP BY s.state_scode, s.state_sname
    ORDER BY memberCount DESC
  `;

  pool.query(query, (err, results) => {
    if (err) {
      console.error('States error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
});

// =============== COMPLETE DASHBOARD API - CORRECT CALCULATIONS ===============



// ==========================================
// NEW: COMPLETE DASHBOARD API - ADD THIS!
// ==========================================
// ==========================================
// ADD THIS NEW API - COMPLETE DASHBOARD SUMMARY
// ==========================================
// ==========================================
// FIXED DASHBOARD SUMMARY API
// ==========================================
/*app.get('/api/dashboard/summary', (req, res) => {
  const query = `
    SELECT 
      -- Basic counts (using correct column names)
      COUNT(*) as totalMembers,
      SUM(CASE WHEN LOWER(isMemberinFPO) = 'yes' THEN 1 ELSE 0 END) as fpoCount,
      SUM(CASE WHEN LOWER(mgnrega) = 'yes' THEN 1 ELSE 0 END) as mgnregaCount,
      
      -- Livestock totals
      SUM(
        COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) + 
        COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) + 
        COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) + 
        COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0)
      ) as totalLivestock,
      
      -- Age average (handle NULL and empty strings)
      ROUND(AVG(CASE 
        WHEN age IS NOT NULL 
          AND age != '' 
          AND age REGEXP '^[0-9]+$' 
          AND CAST(age AS DECIMAL) > 0 
          AND CAST(age AS DECIMAL) < 120 
        THEN CAST(age AS DECIMAL) 
        ELSE NULL 
      END)) as averageAge,
      
      -- Gender counts
      SUM(CASE WHEN LOWER(gender) = 'male' THEN 1 ELSE 0 END) as male,
      SUM(CASE WHEN LOWER(gender) = 'female' THEN 1 ELSE 0 END) as female,
      SUM(CASE WHEN LOWER(gender) NOT IN ('male', 'female') 
                AND gender IS NOT NULL AND TRIM(gender) != '' THEN 1 ELSE 0 END) as other,
      
      -- Irrigation Types
      SUM(CASE WHEN COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 
                OR COALESCE(CAST(areaofCultivationinTankfed AS DECIMAL), 0) > 0
           THEN 1 ELSE 0 END) as tankfed,
      
      SUM(CASE WHEN COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 
                OR COALESCE(CAST(areaofCultivationinRainfed AS DECIMAL), 0) > 0
           THEN 1 ELSE 0 END) as rainfed,
      
      SUM(CASE WHEN COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 
                OR COALESCE(CAST(areaofCultivationinBorewell AS DECIMAL), 0) > 0
           THEN 1 ELSE 0 END) as borewell,
      
      SUM(CASE WHEN COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0 
                OR COALESCE(CAST(areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
           THEN 1 ELSE 0 END) as drip,
      
      -- Activities
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND (COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) = 0 AND
                     COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0) = 0)
           THEN 1 ELSE 0 END) as farmingOnly,
      
      SUM(CASE WHEN (COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0) > 0)
                AND (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) = 0 AND
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) = 0)
           THEN 1 ELSE 0 END) as livestockOnly,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND (COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0) > 0)
           THEN 1 ELSE 0 END) as bothActivities,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) = 0 AND
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) = 0)
                AND (COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) = 0 AND
                     COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) = 0 AND 
                     COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0) = 0)
           THEN 1 ELSE 0 END) as alternativeLivelihoods,
      
      -- Total Irrigation Farmers
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
             THEN 1 ELSE 0 END) as totalIrrigationFarmers,
      
      -- Yield Categories
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) > 0 
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) < 2500
           THEN 1 ELSE 0 END) as aspirant,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) >= 2500
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) < 2600
           THEN 1 ELSE 0 END) as performer,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) >= 2600
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) < 2800
           THEN 1 ELSE 0 END) as frontRunner,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) >= 2800
           THEN 1 ELSE 0 END) as benchMarker,
      
      SUM(CASE WHEN (COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 OR
                     COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 OR 
                     COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0)
                AND GREATEST(COALESCE(CAST(lastyearyields1 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields2 AS DECIMAL), 0), 
                             COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)) = 0
           THEN 1 ELSE 0 END) as noYieldData
          
    FROM myfarmers_data
  `;

  pool.query(query, (err, result) => {
    if (err) {
      console.error('Dashboard summary error:', err);
      return res.status(500).json({ error: err.message });
    }
    
    const summary = result[0];
    
    
    res.json({
      totalMembers: summary.totalMembers || 0,
      fpoCount: summary.fpoCount || 0,
      mgnregaCount: summary.mgnregaCount || 0,
      totalLivestock: summary.totalLivestock || 0,
      averageAge: summary.averageAge ? summary.averageAge.toString() : '0',
      totalIrrigationFarmers: summary.totalIrrigationFarmers || 0,
      
      farmingOnly: summary.farmingOnly || 0,
      livestockOnly: summary.livestockOnly || 0,
      both: summary.bothActivities || 0,
      alternativeLivelihoods: summary.alternativeLivelihoods || 0,
      
      tankfed: summary.tankfed || 0,
      rainfed: summary.rainfed || 0,
      borewell: summary.borewell || 0,
      drip: summary.drip || 0,
      
      aspirant: summary.aspirant || 0,
      performer: summary.performer || 0,
      frontRunner: summary.frontRunner || 0,
      benchMarker: summary.benchMarker || 0,
      noYield: summary.noYieldData || 0,
      
      male: summary.male || 0,
      female: summary.female || 0,
      other: summary.other || 0
    });
  });
});
*/

// ==========================================
// Cache setup (optional)

// ============================================
// API: GET /api/dashboard/summary
// ============================================
// 1. DASHBOARD SUMMARY STATS (FAST)
// ============================================
app.get('/api/dashboard/summary', (req, res) => {
  const cacheKey = 'dashboard_summary';
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return res.status(200).json({
      ...cachedData,
      cached: true,
      timestamp: new Date().toISOString()
    });
  }

  console.log('🔄 Fetching fresh data from database...');

  // Optimized single query with conditional aggregation
  const query = `
    SELECT
      COUNT(*) as totalMembers,
      
      -- FPO Members
      SUM(CASE WHEN LOWER(isMemberinFPO) = 'yes' THEN 1 ELSE 0 END) as fpoCount,
      
      -- MGNREGA Members
      SUM(CASE WHEN LOWER(mgnrega) = 'yes' THEN 1 ELSE 0 END) as mgnregaCount,
      
      -- Total Livestock
      SUM(
        COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) +
        COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) +
        COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) +
        COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0)
      ) as totalLivestock,
      
      -- Irrigation Farmers
      SUM(CASE 
        WHEN (
          COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0
          OR COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          OR COALESCE(CAST(areaofCultivationinTankfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(areaofCultivationinRainfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(areaofCultivationinBorewell AS DECIMAL), 0) > 0
          OR COALESCE(CAST(areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          OR (irrigationType IS NOT NULL AND TRIM(irrigationType) != '')
          OR (irrigationtyperainfed IS NOT NULL AND TRIM(irrigationtyperainfed) != '')
          OR (irrigationtypeborewell IS NOT NULL AND TRIM(irrigationtypeborewell) != '')
          OR (irrigationtypedrip IS NOT NULL AND TRIM(irrigationtypedrip) != '')
        ) THEN 1 ELSE 0 END
      ) as totalIrrigationFarmers,
      
      -- Average Age
      ROUND(AVG(
        CASE 
          WHEN age REGEXP '^[0-9]+$' AND age > 0 AND age < 120 
          THEN CAST(age AS DECIMAL) 
        END
      )) as averageAge,
      
      -- Activity Stats - Farming Only
      SUM(CASE 
        WHEN (
          (soilType1 IS NOT NULL AND TRIM(soilType1) != '') 
          OR (soilType2 IS NOT NULL AND TRIM(soilType2) != '') 
          OR (soilType3 IS NOT NULL AND TRIM(soilType3) != '') 
          OR (soilType IS NOT NULL AND TRIM(soilType) != '')
        )
        AND (
          (FeedingTypeCow IS NULL OR TRIM(FeedingTypeCow) = '') 
          AND (FeedingTypeBuffalow IS NULL OR TRIM(FeedingTypeBuffalow) = '') 
          AND (FeedingTypeGoat IS NULL OR TRIM(FeedingTypeGoat) = '') 
          AND (FeedingTypeSheep IS NULL OR TRIM(FeedingTypeSheep) = '')
        )
        THEN 1 ELSE 0 END
      ) as farmingOnly,
      
      -- Activity Stats - Livestock Only
      SUM(CASE 
        WHEN (
          (FeedingTypeCow IS NOT NULL AND TRIM(FeedingTypeCow) != '') 
          OR (FeedingTypeBuffalow IS NOT NULL AND TRIM(FeedingTypeBuffalow) != '') 
          OR (FeedingTypeGoat IS NOT NULL AND TRIM(FeedingTypeGoat) != '') 
          OR (FeedingTypeSheep IS NOT NULL AND TRIM(FeedingTypeSheep) != '')
        )
        AND (
          (soilType1 IS NULL OR TRIM(soilType1) = '') 
          AND (soilType2 IS NULL OR TRIM(soilType2) = '') 
          AND (soilType3 IS NULL OR TRIM(soilType3) = '') 
          AND (soilType IS NULL OR TRIM(soilType) = '')
        )
        THEN 1 ELSE 0 END
      ) as livestockOnly,
      
      -- Activity Stats - Both
      SUM(CASE 
        WHEN (
          (soilType1 IS NOT NULL AND TRIM(soilType1) != '') 
          OR (soilType2 IS NOT NULL AND TRIM(soilType2) != '') 
          OR (soilType3 IS NOT NULL AND TRIM(soilType3) != '') 
          OR (soilType IS NOT NULL AND TRIM(soilType) != '')
        )
        AND (
          (FeedingTypeCow IS NOT NULL AND TRIM(FeedingTypeCow) != '') 
          OR (FeedingTypeBuffalow IS NOT NULL AND TRIM(FeedingTypeBuffalow) != '') 
          OR (FeedingTypeGoat IS NOT NULL AND TRIM(FeedingTypeGoat) != '') 
          OR (FeedingTypeSheep IS NOT NULL AND TRIM(FeedingTypeSheep) != '')
        )
        THEN 1 ELSE 0 END
      ) as \`both\`,
      
      -- Activity Stats - Alternative Livelihoods
      SUM(CASE 
        WHEN (
          (soilType1 IS NULL OR TRIM(soilType1) = '') 
          AND (soilType2 IS NULL OR TRIM(soilType2) = '') 
          AND (soilType3 IS NULL OR TRIM(soilType3) = '') 
          AND (soilType IS NULL OR TRIM(soilType) = '')
        )
        AND (
          (FeedingTypeCow IS NULL OR TRIM(FeedingTypeCow) = '') 
          AND (FeedingTypeBuffalow IS NULL OR TRIM(FeedingTypeBuffalow) = '') 
          AND (FeedingTypeGoat IS NULL OR TRIM(FeedingTypeGoat) = '') 
          AND (FeedingTypeSheep IS NULL OR TRIM(FeedingTypeSheep) = '')
        )
        THEN 1 ELSE 0 END
      ) as alternativeLivelihoods,
      
      -- Irrigation Types
      SUM(CASE 
        WHEN COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(areaofCultivationinTankfed AS DECIMAL), 0) > 0
          OR (irrigationType IS NOT NULL AND LOWER(irrigationType) LIKE '%tank%')
        THEN 1 ELSE 0 END
      ) as tankfed,
      
      SUM(CASE 
        WHEN COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(areaofCultivationinRainfed AS DECIMAL), 0) > 0
          OR (irrigationType IS NOT NULL AND LOWER(irrigationType) LIKE '%rain%')
          OR (irrigationtyperainfed IS NOT NULL AND TRIM(irrigationtyperainfed) != '')
        THEN 1 ELSE 0 END
      ) as rainfed,
      
      SUM(CASE 
        WHEN COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(areaofCultivationinBorewell AS DECIMAL), 0) > 0
          OR (irrigationType IS NOT NULL AND LOWER(irrigationType) LIKE '%bore%')
          OR (irrigationtypeborewell IS NOT NULL AND TRIM(irrigationtypeborewell) != '')
        THEN 1 ELSE 0 END
      ) as borewell,
      
      SUM(CASE 
        WHEN COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          OR (irrigationType IS NOT NULL AND LOWER(irrigationType) LIKE '%drip%')
          OR (irrigationtypedrip IS NOT NULL AND TRIM(irrigationtypedrip) != '')
        THEN 1 ELSE 0 END
      ) as drip,
      
      -- Yield Categories
      SUM(CASE 
        WHEN GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) > 0 
        AND GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) < 2500
        THEN 1 ELSE 0 END
      ) as aspirant,
      
      SUM(CASE 
        WHEN GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) >= 2500 
        AND GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) < 2600
        THEN 1 ELSE 0 END
      ) as performer,
      
      SUM(CASE 
        WHEN GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) >= 2600 
        AND GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) < 2800
        THEN 1 ELSE 0 END
      ) as frontRunner,
      
      SUM(CASE 
        WHEN GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) >= 2800
        THEN 1 ELSE 0 END
      ) as benchMarker,
      
      SUM(CASE 
        WHEN GREATEST(
          COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
          COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
        ) = 0
        THEN 1 ELSE 0 END
      ) as noYield,
      
      -- Gender Stats
      SUM(CASE WHEN LOWER(gender) = 'male' THEN 1 ELSE 0 END) as male,
      SUM(CASE WHEN LOWER(gender) = 'female' THEN 1 ELSE 0 END) as female,
      SUM(CASE 
        WHEN LOWER(gender) NOT IN ('male', 'female') 
        AND gender IS NOT NULL 
        AND TRIM(gender) != ''
        THEN 1 ELSE 0 END
      ) as other
      
    FROM myfarmers_data
  `;

  pool.query(query, (error, results) => {
    if (error) {
      console.error('Error fetching dashboard summary:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching dashboard summary',
        error: error.message
      });
    }

    // Store in cache
    cache.set(cacheKey, results[0]);

    res.status(200).json({
      ...results[0],
      cached: false,
      timestamp: new Date().toISOString()
    });
  });
});

// ============================================
// API: GET /api/members/filtered - Optimized for millions of records
// Supports pagination, filtering, and searching
// ============================================
// ============================================
// API: GET /api/members/filtered - FIXED VERSION
// ============================================
// ============================================
// API: GET /api/members/filtered - WITH JOINS
// ============================================
// ============================================
// API: GET /api/members/filtered - COMPLETE FIX
// ============================================
app.get('/api/members/filtered', (req, res) => {
  const {
    page = 1,
    limit = 50,
    filterKey,
    filterValue,
    search
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const pageLimit = parseInt(limit);

  console.log('📊 Filter Request:', { page, limit: pageLimit, filterKey, filterValue, search });

  let whereConditions = [];
  let queryParams = [];

  // Apply filter based on filterKey
  if (filterKey && filterKey !== 'all') {
    switch (filterKey) {
      case 'fpo':
        whereConditions.push('LOWER(m.isMemberinFPO) = ?');
        queryParams.push('yes');
        break;
      case 'mgnrega':
        whereConditions.push('LOWER(m.mgnrega) = ?');
        queryParams.push('yes');
        break;
      case 'livestock':
        whereConditions.push(`(
          COALESCE(CAST(m.NoofLivestockCow AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockBuffalow AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockGoat AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockSheep AS DECIMAL), 0) > 0
        )`);
        break;
      case 'irrigation_all':
        whereConditions.push(`(
          COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
        )`);
        break;
      case 'state':
        whereConditions.push('m.state_scode = ?');
        queryParams.push(filterValue);
        break;
      case 'gender':
        whereConditions.push('LOWER(m.gender) = ?');
        queryParams.push(filterValue.toLowerCase());
        break;
      case 'group':
        whereConditions.push('m.group_gcode = ?');
        queryParams.push(filterValue);
        break;
      case 'group_members':
        whereConditions.push('m.group_gcode = ? AND m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != ""');
        queryParams.push(filterValue);
        break;
      case 'group_nonmembers':
        whereConditions.push('m.group_gcode = ? AND (m.member_mcode IS NULL OR TRIM(m.member_mcode) = "") AND m.nonmembername IS NOT NULL AND TRIM(m.nonmembername) != ""');
        queryParams.push(filterValue);
        break;
      case 'irrigation':
        if (filterValue === 'Tankfed') {
          whereConditions.push(`COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL), 0) > 0`);
        } else if (filterValue === 'Rainfed') {
          whereConditions.push(`COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL), 0) > 0`);
        } else if (filterValue === 'Borewell') {
          whereConditions.push(`COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL), 0) > 0`);
        } else if (filterValue === 'Drip') {
          whereConditions.push(`COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0`);
        }
        break;
      case 'yield':
        if (filterValue === 'Aspirant') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) > 0 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2500`);
        } else if (filterValue === 'Performer') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2500 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2600`);
        } else if (filterValue === 'Front Runner') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2600 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2800`);
        } else if (filterValue === 'Bench Marker') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2800`);
        } else if (filterValue === 'No Yield Data') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) = 0`);
        }
        break;
      default:
        break;
    }
  }

  // Search
  if (search) {
    const searchTerm = `%${search}%`;
    whereConditions.push(`(
      m.farmerName LIKE ? OR
      m.member_mcode LIKE ? OR
      m.nonmembername LIKE ? OR
      m.gender LIKE ? OR
      m.age LIKE ? OR
      m.farmerMobile LIKE ? OR
      s.state_sname LIKE ? OR
      d.district_dname LIKE ? OR
      l.location_lname LIKE ? OR
      c.cluster_cname LIKE ? OR
      g.group_cname LIKE ? OR
      m.isMemberinFPO LIKE ? OR
      m.mgnrega LIKE ?
    )`);
    queryParams.push(
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm,
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm,
      searchTerm, searchTerm
    );
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Count query
  const countQuery = `SELECT COUNT(*) as total FROM myfarmers_data m ${whereClause}`;
  
  // Data query with SIMPLE JOINs (no extra conditions)
  const dataQuery = `
    SELECT 
      m.*,
      COALESCE(s.state_sname, '') as state_sname,
      COALESCE(d.district_dname, '') as district_name,
      COALESCE(l.location_lname, '') as location_name,
      COALESCE(c.cluster_cname, '') as cluster_name,
      COALESCE(g.group_cname, '') as group_name
    FROM myfarmers_data m
    LEFT JOIN state s ON m.state_scode = s.state_scode
    LEFT JOIN district d ON m.district_dcode = d.district_dcode
    LEFT JOIN location l ON m.location_lcode = l.location_lcode
    LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
    LEFT JOIN grp g ON m.group_gcode = g.group_gcode
    ${whereClause}
    ORDER BY m.id ASC
    LIMIT ? OFFSET ?
  `;

  console.log('🔍 Filter Query:', { filterKey, filterValue, whereClause });
  console.log('📊 Data Query:', dataQuery);

  // Execute count query
  pool.query(countQuery, queryParams, (countError, countResults) => {
    if (countError) {
      console.error('Error counting records:', countError);
      return res.status(500).json({
        success: false,
        message: 'Error counting records',
        error: countError.message
      });
    }

    const totalRecords = countResults[0].total;
    const totalPages = Math.ceil(totalRecords / pageLimit);

    // Execute data query
    const dataParams = [...queryParams, pageLimit, offset];
    pool.query(dataQuery, dataParams, (dataError, dataResults) => {
      if (dataError) {
        console.error('Error fetching records:', dataError);
        return res.status(500).json({
          success: false,
          message: 'Error fetching records',
          error: dataError.message
        });
      }

      console.log(`✅ Found ${totalRecords} records, returning ${dataResults.length} records`);

      res.status(200).json({
        success: true,
        data: dataResults,
        pagination: {
          currentPage: parseInt(page),
          itemsPerPage: pageLimit,
          totalRecords: totalRecords,
          totalPages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      });
    });
  });
});


app.get('/api/geo/all', (req, res) => {
  const cacheKey = 'geo_all_data';
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    return res.json({
      success: true,
      data: cachedData,
      cached: true,
      timestamp: new Date().toISOString()
    });
  }

  // Use simpler queries without JOINs
  const queries = {
    states: 'SELECT state_scode, state_sname FROM state',
    districts: 'SELECT district_dcode, district_dname, state_scode FROM district',
    locations: 'SELECT location_lcode, location_lname, district_dcode, state_scode FROM location',
    clusters: 'SELECT cluster_ccode, cluster_cname, location_lcode, district_dcode, state_scode FROM cluster',
    groups: 'SELECT group_gcode, group_cname, cluster_ccode, location_lcode, district_dcode, state_scode FROM grp'
  };

  Promise.all([
    new Promise((resolve) => pool.query(queries.states, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.districts, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.locations, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.clusters, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.groups, (err, results) => resolve(results || [])))
  ])
  .then(([states, districts, locations, clusters, groups]) => {
    const data = { states, districts, locations, clusters, groups };
    
    // Cache for 1 hour
    cache.set(cacheKey, data, 3600);
    
    res.json({
      success: true,
      data: data,
      cached: false,
      timestamp: new Date().toISOString()
    });
  })
  .catch(err => {
    console.error('Error fetching geographic data:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Error fetching geographic data' 
    });
  });
});
// ==========
// ================================
// Clear cache (call this after data updates)
// ==========================================
app.post('/api/clear-cache', (req, res) => {
  dataCache.flushAll();
  console.log('Cache cleared');
  res.json({ message: 'Cache cleared successfully' });
});


// ============================================
// API: GET /api/members/table - With proper JOINs
// ============================================
app.get('/api/members/table', (req, res) => {
  const {
    page = 1,
    limit = 50,
    filterKey,
    filterValue,
    search
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const pageLimit = parseInt(limit);

  // Build WHERE clause based on filterKey and filterValue
  let whereConditions = [];
  let queryParams = [];

  // Apply filter based on filterKey
  if (filterKey && filterKey !== 'all') {
    switch (filterKey) {
      case 'fpo':
        whereConditions.push('LOWER(m.isMemberinFPO) = ?');
        queryParams.push('yes');
        break;
      case 'mgnrega':
        whereConditions.push('LOWER(m.mgnrega) = ?');
        queryParams.push('yes');
        break;
      case 'livestock':
        whereConditions.push(`(
          COALESCE(CAST(m.NoofLivestockCow AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockBuffalow AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockGoat AS DECIMAL), 0) > 0 
          OR COALESCE(CAST(m.NoofLivestockSheep AS DECIMAL), 0) > 0
        )`);
        break;
      case 'irrigation_all':
        whereConditions.push(`(
          COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.areaofCultivationinTankfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.areaofCultivationinRainfed AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.areaofCultivationinBorewell AS DECIMAL), 0) > 0
          OR COALESCE(CAST(m.areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          OR (m.irrigationType IS NOT NULL AND TRIM(m.irrigationType) != '')
          OR (m.irrigationtyperainfed IS NOT NULL AND TRIM(m.irrigationtyperainfed) != '')
          OR (m.irrigationtypeborewell IS NOT NULL AND TRIM(m.irrigationtypeborewell) != '')
          OR (m.irrigationtypedrip IS NOT NULL AND TRIM(m.irrigationtypedrip) != '')
        )`);
        break;
      case 'farming_only':
        whereConditions.push(`(
          (m.soilType1 IS NOT NULL AND TRIM(m.soilType1) != '') 
          OR (m.soilType2 IS NOT NULL AND TRIM(m.soilType2) != '') 
          OR (m.soilType3 IS NOT NULL AND TRIM(m.soilType3) != '') 
          OR (m.soilType IS NOT NULL AND TRIM(m.soilType) != '')
        ) AND (
          (m.FeedingTypeCow IS NULL OR TRIM(m.FeedingTypeCow) = '') 
          AND (m.FeedingTypeBuffalow IS NULL OR TRIM(m.FeedingTypeBuffalow) = '') 
          AND (m.FeedingTypeGoat IS NULL OR TRIM(m.FeedingTypeGoat) = '') 
          AND (m.FeedingTypeSheep IS NULL OR TRIM(m.FeedingTypeSheep) = '')
        )`);
        break;
      case 'livestock_only':
        whereConditions.push(`(
          (m.FeedingTypeCow IS NOT NULL AND TRIM(m.FeedingTypeCow) != '') 
          OR (m.FeedingTypeBuffalow IS NOT NULL AND TRIM(m.FeedingTypeBuffalow) != '') 
          OR (m.FeedingTypeGoat IS NOT NULL AND TRIM(m.FeedingTypeGoat) != '') 
          OR (m.FeedingTypeSheep IS NOT NULL AND TRIM(m.FeedingTypeSheep) != '')
        ) AND (
          (m.soilType1 IS NULL OR TRIM(m.soilType1) = '') 
          AND (m.soilType2 IS NULL OR TRIM(m.soilType2) = '') 
          AND (m.soilType3 IS NULL OR TRIM(m.soilType3) = '') 
          AND (m.soilType IS NULL OR TRIM(m.soilType) = '')
        )`);
        break;
      case 'both':
        whereConditions.push(`(
          (m.soilType1 IS NOT NULL AND TRIM(m.soilType1) != '') 
          OR (m.soilType2 IS NOT NULL AND TRIM(m.soilType2) != '') 
          OR (m.soilType3 IS NOT NULL AND TRIM(m.soilType3) != '') 
          OR (m.soilType IS NOT NULL AND TRIM(m.soilType) != '')
        ) AND (
          (m.FeedingTypeCow IS NOT NULL AND TRIM(m.FeedingTypeCow) != '') 
          OR (m.FeedingTypeBuffalow IS NOT NULL AND TRIM(m.FeedingTypeBuffalow) != '') 
          OR (m.FeedingTypeGoat IS NOT NULL AND TRIM(m.FeedingTypeGoat) != '') 
          OR (m.FeedingTypeSheep IS NOT NULL AND TRIM(m.FeedingTypeSheep) != '')
        )`);
        break;
      case 'alt_livelihoods':
        whereConditions.push(`(
          (m.soilType1 IS NULL OR TRIM(m.soilType1) = '') 
          AND (m.soilType2 IS NULL OR TRIM(m.soilType2) = '') 
          AND (m.soilType3 IS NULL OR TRIM(m.soilType3) = '') 
          AND (m.soilType IS NULL OR TRIM(m.soilType) = '')
        ) AND (
          (m.FeedingTypeCow IS NULL OR TRIM(m.FeedingTypeCow) = '') 
          AND (m.FeedingTypeBuffalow IS NULL OR TRIM(m.FeedingTypeBuffalow) = '') 
          AND (m.FeedingTypeGoat IS NULL OR TRIM(m.FeedingTypeGoat) = '') 
          AND (m.FeedingTypeSheep IS NULL OR TRIM(m.FeedingTypeSheep) = '')
        )`);
        break;
      case 'irrigation':
        if (filterValue === 'Tankfed') {
          whereConditions.push(`(
            COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(m.areaofCultivationinTankfed AS DECIMAL), 0) > 0
            OR (m.irrigationType IS NOT NULL AND LOWER(m.irrigationType) LIKE '%tank%')
          )`);
        } else if (filterValue === 'Rainfed') {
          whereConditions.push(`(
            COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(m.areaofCultivationinRainfed AS DECIMAL), 0) > 0
            OR (m.irrigationType IS NOT NULL AND LOWER(m.irrigationType) LIKE '%rain%')
            OR (m.irrigationtyperainfed IS NOT NULL AND TRIM(m.irrigationtyperainfed) != '')
          )`);
        } else if (filterValue === 'Borewell') {
          whereConditions.push(`(
            COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(m.areaofCultivationinBorewell AS DECIMAL), 0) > 0
            OR (m.irrigationType IS NOT NULL AND LOWER(m.irrigationType) LIKE '%bore%')
            OR (m.irrigationtypeborewell IS NOT NULL AND TRIM(m.irrigationtypeborewell) != '')
          )`);
        } else if (filterValue === 'Drip') {
          whereConditions.push(`(
            COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(m.areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
            OR (m.irrigationType IS NOT NULL AND LOWER(m.irrigationType) LIKE '%drip%')
            OR (m.irrigationtypedrip IS NOT NULL AND TRIM(m.irrigationtypedrip) != '')
          )`);
        }
        break;
      case 'yield':
        if (filterValue === 'Aspirant') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) > 0 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2500`);
        } else if (filterValue === 'Performer') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2500 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2600`);
        } else if (filterValue === 'Front Runner') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2600 AND GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) < 2800`);
        } else if (filterValue === 'Bench Marker') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) >= 2800`);
        } else if (filterValue === 'No Yield Data') {
          whereConditions.push(`GREATEST(
            COALESCE(CAST(m.lastyearyields1 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields2 AS DECIMAL), 0),
            COALESCE(CAST(m.lastyearyields3 AS DECIMAL), 0)
          ) = 0`);
        }
        break;
      case 'state':
        whereConditions.push('m.state_scode = ?');
        queryParams.push(filterValue);
        break;
      case 'gender':
        whereConditions.push('LOWER(m.gender) = ?');
        queryParams.push(filterValue.toLowerCase());
        break;
      default:
        break;
    }
  }

  // Global search with JOINs
  if (search) {
    const searchTerm = `%${search}%`;
    whereConditions.push(`(
      m.farmerName LIKE ? OR
      m.member_mcode LIKE ? OR
      m.nonmembername LIKE ? OR
      m.gender LIKE ? OR
      m.age LIKE ? OR
      m.farmerMobile LIKE ? OR
      m.isMemberinFPO LIKE ? OR
      m.mgnrega LIKE ? OR
      s.state_sname LIKE ? OR
      d.district_dname LIKE ? OR
      l.location_lname LIKE ? OR
      c.cluster_cname LIKE ? OR
      g.group_cname LIKE ?
    )`);
    queryParams.push(
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm,
      searchTerm, searchTerm,
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm
    );
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  const orderClause = 'ORDER BY m.id DESC';

  // COUNT query with JOINs
const countQuery = `
  SELECT COUNT(*) as total 
  FROM myfarmers_data m
  LEFT JOIN state s ON TRIM(m.state_scode) = TRIM(s.state_scode)
  LEFT JOIN district d ON TRIM(m.district_dcode) = TRIM(d.district_dcode)
  LEFT JOIN location l ON TRIM(m.location_lcode) = TRIM(l.location_lcode)
  LEFT JOIN cluster c ON TRIM(m.cluster_ccode) = TRIM(c.cluster_ccode)
  LEFT JOIN grp g ON TRIM(m.group_gcode) = TRIM(g.group_gcode)
  ${whereClause}
`;


// Debug endpoint to check district mapping
app.get('/api/debug/district/:code', (req, res) => {
  const code = req.params.code;
  
  const query = `
    SELECT 
      '${code}' as input_code,
      d.district_dcode as db_code,
      d.district_dname as db_name,
      LENGTH('${code}') as input_length,
      LENGTH(d.district_dcode) as db_length,
      '${code}' = d.district_dcode as exact_match,
      TRIM('${code}') = TRIM(d.district_dcode) as trim_match
    FROM district d
    WHERE d.district_dcode = '${code}' OR TRIM(d.district_dcode) = TRIM('${code}')
    LIMIT 1
  `;
  
  pool.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      code: code,
      results: results
    });
  });
});
  // DATA query with JOINs - returns all columns with names
// In the dataQuery for /api/members/table
const dataQuery = `
  SELECT 
    m.*,
    COALESCE(s.state_sname, m.state_scode, 'Unknown') as state_sname,
    COALESCE(d.district_dname, m.district_dcode, 'Unknown') as district_name,
    COALESCE(l.location_lname, m.location_lcode, 'Unknown') as location_name,
    COALESCE(c.cluster_cname, m.cluster_ccode, 'Unknown') as cluster_name,
    COALESCE(g.group_cname, m.group_gcode, 'Unknown') as group_name
  FROM myfarmers_data m
  LEFT JOIN state s ON TRIM(m.state_scode) = TRIM(s.state_scode)
  LEFT JOIN district d ON (
    TRIM(m.district_dcode) = TRIM(d.district_dcode)
    OR CAST(TRIM(m.district_dcode) AS CHAR) = CAST(TRIM(d.district_dcode) AS CHAR)
  )
  LEFT JOIN location l ON (
    TRIM(m.location_lcode) = TRIM(l.location_lcode)
    OR CAST(TRIM(m.location_lcode) AS CHAR) = CAST(TRIM(l.location_lcode) AS CHAR)
  )
  LEFT JOIN cluster c ON (
    TRIM(m.cluster_ccode) = TRIM(c.cluster_ccode)
    OR CAST(TRIM(m.cluster_ccode) AS CHAR) = CAST(TRIM(c.cluster_ccode) AS CHAR)
  )
  LEFT JOIN grp g ON (
    TRIM(m.group_gcode) = TRIM(g.group_gcode)
    OR CAST(TRIM(m.group_gcode) AS CHAR) = CAST(TRIM(g.group_gcode) AS CHAR)
  )
  ${whereClause} 
  ${orderClause} 
  LIMIT ? OFFSET ?
`;



  console.log('🔍 Filter Query:', { filterKey, filterValue, whereClause });

  // Execute count query
  pool.query(countQuery, queryParams, (countError, countResults) => {
    if (countError) {
      console.error('Error counting records:', countError);
      return res.status(500).json({
        success: false,
        message: 'Error counting records',
        error: countError.message
      });
    }

    const totalRecords = countResults[0].total;
    const totalPages = Math.ceil(totalRecords / pageLimit);

    // Execute data query with pagination
    const dataParams = [...queryParams, pageLimit, offset];
    pool.query(dataQuery, dataParams, (dataError, dataResults) => {
      if (dataError) {
        console.error('Error fetching records:', dataError);
        return res.status(500).json({
          success: false,
          message: 'Error fetching records',
          error: dataError.message
        });
      }

      res.status(200).json({
        success: true,
        data: dataResults,
        pagination: {
          currentPage: parseInt(page),
          itemsPerPage: pageLimit,
          totalRecords: totalRecords,
          totalPages: totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      });
    });
  });
});


//test
// ==========================================
// MEMBERS TABLE ENDPOINT - For the MembersTable component
// ==========================================
app.get('/api/members/table', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      filterKey,
      filterValue,
      state,
      district,
      location,
      cluster,
      group,
      search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = Math.min(parseInt(limit), 100);

    console.log('📊 Members Table Request:', { page, limit, filterKey, filterValue, state, district, location, cluster, group, search });

    // Build WHERE clause
    let whereConditions = [];
    let queryParams = [];

    // Apply filter based on filterKey
    if (filterKey && filterKey !== 'all') {
      switch (filterKey) {
        case 'fpo':
          whereConditions.push('LOWER(isMemberinFPO) = ?');
          queryParams.push('yes');
          break;
        case 'mgnrega':
          whereConditions.push('LOWER(mgnrega) = ?');
          queryParams.push('yes');
          break;
        case 'livestock':
          whereConditions.push(`(
            COALESCE(CAST(NoofLivestockCow AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(NoofLivestockBuffalow AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(NoofLivestockGoat AS DECIMAL), 0) > 0 
            OR COALESCE(CAST(NoofLivestockSheep AS DECIMAL), 0) > 0
          )`);
          break;
        case 'irrigation_all':
          whereConditions.push(`(
            COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0
            OR COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0
            OR COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0
            OR COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
          )`);
          break;
        case 'state':
          whereConditions.push('state_scode = ?');
          queryParams.push(filterValue);
          break;
        case 'gender':
          whereConditions.push('LOWER(gender) = ?');
          queryParams.push(filterValue.toLowerCase());
          break;
        case 'yield':
          if (filterValue === 'Aspirant') {
            whereConditions.push(`GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) > 0 AND GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) < 2500`);
          } else if (filterValue === 'Performer') {
            whereConditions.push(`GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) >= 2500 AND GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) < 2600`);
          } else if (filterValue === 'Front Runner') {
            whereConditions.push(`GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) >= 2600 AND GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) < 2800`);
          } else if (filterValue === 'Bench Marker') {
            whereConditions.push(`GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) >= 2800`);
          } else if (filterValue === 'No Yield Data') {
            whereConditions.push(`GREATEST(
              COALESCE(CAST(lastyearyields1 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields2 AS DECIMAL), 0),
              COALESCE(CAST(lastyearyields3 AS DECIMAL), 0)
            ) = 0`);
          }
          break;
        case 'irrigation':
          if (filterValue === 'Tankfed') {
            whereConditions.push(`(
              COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 
              OR COALESCE(CAST(areaofCultivationinTankfed AS DECIMAL), 0) > 0
            )`);
          } else if (filterValue === 'Rainfed') {
            whereConditions.push(`(
              COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 
              OR COALESCE(CAST(areaofCultivationinRainfed AS DECIMAL), 0) > 0
            )`);
          } else if (filterValue === 'Borewell') {
            whereConditions.push(`(
              COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 
              OR COALESCE(CAST(areaofCultivationinBorewell AS DECIMAL), 0) > 0
            )`);
          } else if (filterValue === 'Drip') {
            whereConditions.push(`(
              COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0 
              OR COALESCE(CAST(areaofCultivationinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
            )`);
          }
          break;
        case 'farming_only':
          whereConditions.push(`(
            (soilType1 IS NOT NULL AND TRIM(soilType1) != '') 
            OR (soilType2 IS NOT NULL AND TRIM(soilType2) != '') 
            OR (soilType3 IS NOT NULL AND TRIM(soilType3) != '') 
            OR (soilType IS NOT NULL AND TRIM(soilType) != '')
          ) AND (
            (FeedingTypeCow IS NULL OR TRIM(FeedingTypeCow) = '') 
            AND (FeedingTypeBuffalow IS NULL OR TRIM(FeedingTypeBuffalow) = '') 
            AND (FeedingTypeGoat IS NULL OR TRIM(FeedingTypeGoat) = '') 
            AND (FeedingTypeSheep IS NULL OR TRIM(FeedingTypeSheep) = '')
          )`);
          break;
        case 'livestock_only':
          whereConditions.push(`(
            (FeedingTypeCow IS NOT NULL AND TRIM(FeedingTypeCow) != '') 
            OR (FeedingTypeBuffalow IS NOT NULL AND TRIM(FeedingTypeBuffalow) != '') 
            OR (FeedingTypeGoat IS NOT NULL AND TRIM(FeedingTypeGoat) != '') 
            OR (FeedingTypeSheep IS NOT NULL AND TRIM(FeedingTypeSheep) != '')
          ) AND (
            (soilType1 IS NULL OR TRIM(soilType1) = '') 
            AND (soilType2 IS NULL OR TRIM(soilType2) = '') 
            AND (soilType3 IS NULL OR TRIM(soilType3) = '') 
            AND (soilType IS NULL OR TRIM(soilType) = '')
          )`);
          break;
        case 'both':
          whereConditions.push(`(
            (soilType1 IS NOT NULL AND TRIM(soilType1) != '') 
            OR (soilType2 IS NOT NULL AND TRIM(soilType2) != '') 
            OR (soilType3 IS NOT NULL AND TRIM(soilType3) != '') 
            OR (soilType IS NOT NULL AND TRIM(soilType) != '')
          ) AND (
            (FeedingTypeCow IS NOT NULL AND TRIM(FeedingTypeCow) != '') 
            OR (FeedingTypeBuffalow IS NOT NULL AND TRIM(FeedingTypeBuffalow) != '') 
            OR (FeedingTypeGoat IS NOT NULL AND TRIM(FeedingTypeGoat) != '') 
            OR (FeedingTypeSheep IS NOT NULL AND TRIM(FeedingTypeSheep) != '')
          )`);
          break;
        case 'alt_livelihoods':
          whereConditions.push(`(
            (soilType1 IS NULL OR TRIM(soilType1) = '') 
            AND (soilType2 IS NULL OR TRIM(soilType2) = '') 
            AND (soilType3 IS NULL OR TRIM(soilType3) = '') 
            AND (soilType IS NULL OR TRIM(soilType) = '')
          ) AND (
            (FeedingTypeCow IS NULL OR TRIM(FeedingTypeCow) = '') 
            AND (FeedingTypeBuffalow IS NULL OR TRIM(FeedingTypeBuffalow) = '') 
            AND (FeedingTypeGoat IS NULL OR TRIM(FeedingTypeGoat) = '') 
            AND (FeedingTypeSheep IS NULL OR TRIM(FeedingTypeSheep) = '')
          )`);
          break;
        default:
          break;
      }
    }

    // Location filters
    if (state) {
      whereConditions.push('state_scode = ?');
      queryParams.push(state);
    }
    if (district) {
      whereConditions.push('district_dcode = ?');
      queryParams.push(district);
    }
    if (location) {
      whereConditions.push('location_lcode = ?');
      queryParams.push(location);
    }
    if (cluster) {
      whereConditions.push('cluster_ccode = ?');
      queryParams.push(cluster);
    }
    if (group) {
      whereConditions.push('group_gcode = ?');
      queryParams.push(group);
    }

    // Search
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereConditions.push(`(
        farmerName LIKE ? OR
        member_mcode LIKE ? OR
        nonmembername LIKE ? OR
        gender LIKE ? OR
        age LIKE ? OR
        farmerMobile LIKE ? OR
        aadharNumber LIKE ? OR
        doorNo LIKE ? OR
        street LIKE ? OR
        spouseName LIKE ? OR
        fatherName LIKE ?
      )`);
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, 
                       searchTerm, searchTerm, searchTerm, searchTerm, 
                       searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM myfarmers_data ${whereClause}`;
    const [countResult] = await poolPromise.query(countQuery, queryParams);
    const totalRecords = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / pageLimit);

    console.log(`📊 Total records: ${totalRecords}, Pages: ${totalPages}`);

    // Get data with all columns
    const dataQuery = `
      SELECT 
        m.*,
        COALESCE(s.state_sname, '') as state_sname,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      ${whereClause}
      ORDER BY m.id DESC
      LIMIT ? OFFSET ?
    `;
    
    const [results] = await poolPromise.query(dataQuery, [...queryParams, pageLimit, offset]);

    // Add row numbers
    const dataWithSno = results.map((row, index) => ({
      ...row,
      sno: offset + index + 1
    }));

    res.status(200).json({
      success: true,
      data: dataWithSno,
      pagination: {
        currentPage: parseInt(page),
        itemsPerPage: pageLimit,
        totalRecords: totalRecords,
        totalPages: totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('❌ Error in /api/members/table:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching records',
      error: error.message
    });
  }
});



// ============================================
// HELPER FUNCTION: Enrich crop data
// ============================================
async function enrichCropData(results) {
  if (!results || results.length === 0) return;

  try {
    // Get unique crop codes
    const ccode1s = [...new Set(results.map(r => r.ccode1).filter(Boolean))];
    const ccode2s = [...new Set(results.map(r => r.ccode2).filter(Boolean))];
    const ccode3s = [...new Set(results.map(r => r.ccode3).filter(Boolean))];
    const ccodes = [...new Set(results.map(r => r.ccode).filter(Boolean))];
    const accodes = [...new Set(results.map(r => r.accode).filter(Boolean))];
    
    // Get unique variety IDs
    const v1Ids = [...new Set(results.map(r => r.v_id1).filter(Boolean))];
    const v2Ids = [...new Set(results.map(r => r.v_id2).filter(Boolean))];
    const v3Ids = [...new Set(results.map(r => r.v_id3).filter(Boolean))];
    const vIds = [...new Set(results.map(r => r.v_id).filter(Boolean))];
    const avIds = [...new Set(results.map(r => r.av_id).filter(Boolean))];
    
    // Get unique sub-variety IDs
    const sv1Ids = [...new Set(results.map(r => r.sv_id1).filter(Boolean))];
    const sv2Ids = [...new Set(results.map(r => r.sv_id2).filter(Boolean))];
    const sv3Ids = [...new Set(results.map(r => r.sv_id3).filter(Boolean))];
    const svIds = [...new Set(results.map(r => r.sv_id).filter(Boolean))];
    const asvIds = [...new Set(results.map(r => r.asv_id).filter(Boolean))];

    // Fetch all crop data in parallel
    const [
      crop1Results, crop2Results, crop3Results, cropResults, addCropResults,
      variety1Results, variety2Results, variety3Results, varietyResults, addVarietyResults,
      subVariety1Results, subVariety2Results, subVariety3Results, subVarietyResults, addSubVarietyResults
    ] = await Promise.all([
      ccode1s.length ? poolPromise.query('SELECT ccode1, cname FROM cropmaster1 WHERE ccode1 IN (?)', [ccode1s]) : [[[]]],
      ccode2s.length ? poolPromise.query('SELECT ccode2, cname FROM cropmaster2 WHERE ccode2 IN (?)', [ccode2s]) : [[[]]],
      ccode3s.length ? poolPromise.query('SELECT ccode3, cname FROM cropmaster3 WHERE ccode3 IN (?)', [ccode3s]) : [[[]]],
      ccodes.length ? poolPromise.query('SELECT ccode, cname FROM cropmaster WHERE ccode IN (?)', [ccodes]) : [[[]]],
      accodes.length ? poolPromise.query('SELECT accode, acname FROM addcropmaster WHERE accode IN (?)', [accodes]) : [[[]]],
      v1Ids.length ? poolPromise.query('SELECT v_id1, cvariety FROM cropvariety1 WHERE v_id1 IN (?)', [v1Ids]) : [[[]]],
      v2Ids.length ? poolPromise.query('SELECT v_id2, cvariety FROM cropvariety2 WHERE v_id2 IN (?)', [v2Ids]) : [[[]]],
      v3Ids.length ? poolPromise.query('SELECT v_id3, cvariety FROM cropvariety3 WHERE v_id3 IN (?)', [v3Ids]) : [[[]]],
      vIds.length ? poolPromise.query('SELECT v_id, cvariety FROM cropvariety WHERE v_id IN (?)', [vIds]) : [[[]]],
      avIds.length ? poolPromise.query('SELECT av_id, acvariety FROM addcropvariety WHERE av_id IN (?)', [avIds]) : [[[]]],
      sv1Ids.length ? poolPromise.query('SELECT sv_id1, subvariety FROM cropsubvariety1 WHERE sv_id1 IN (?)', [sv1Ids]) : [[[]]],
      sv2Ids.length ? poolPromise.query('SELECT sv_id2, subvariety FROM cropsubvariety2 WHERE sv_id2 IN (?)', [sv2Ids]) : [[[]]],
      sv3Ids.length ? poolPromise.query('SELECT sv_id3, subvariety FROM cropsubvariety3 WHERE sv_id3 IN (?)', [sv3Ids]) : [[[]]],
      svIds.length ? poolPromise.query('SELECT sv_id, subvariety FROM cropsubvariety WHERE sv_id IN (?)', [svIds]) : [[[]]],
      asvIds.length ? poolPromise.query('SELECT asv_id, asubvariety FROM addcropsubvariety WHERE asv_id IN (?)', [asvIds]) : [[[]]]
    ]);

    // Create lookup maps
    const cropMap1 = Object.fromEntries((crop1Results[0] || []).map(c => [c.ccode1, c.cname]));
    const cropMap2 = Object.fromEntries((crop2Results[0] || []).map(c => [c.ccode2, c.cname]));
    const cropMap3 = Object.fromEntries((crop3Results[0] || []).map(c => [c.ccode3, c.cname]));
    const cropMap = Object.fromEntries((cropResults[0] || []).map(c => [c.ccode, c.cname]));
    const addCropMap = Object.fromEntries((addCropResults[0] || []).map(c => [c.accode, c.acname]));
    
    const varietyMap1 = Object.fromEntries((variety1Results[0] || []).map(v => [v.v_id1, v.cvariety]));
    const varietyMap2 = Object.fromEntries((variety2Results[0] || []).map(v => [v.v_id2, v.cvariety]));
    const varietyMap3 = Object.fromEntries((variety3Results[0] || []).map(v => [v.v_id3, v.cvariety]));
    const varietyMap = Object.fromEntries((varietyResults[0] || []).map(v => [v.v_id, v.cvariety]));
    const addVarietyMap = Object.fromEntries((addVarietyResults[0] || []).map(v => [v.av_id, v.acvariety]));
    
    const subVarietyMap1 = Object.fromEntries((subVariety1Results[0] || []).map(sv => [sv.sv_id1, sv.subvariety]));
    const subVarietyMap2 = Object.fromEntries((subVariety2Results[0] || []).map(sv => [sv.sv_id2, sv.subvariety]));
    const subVarietyMap3 = Object.fromEntries((subVariety3Results[0] || []).map(sv => [sv.sv_id3, sv.subvariety]));
    const subVarietyMap = Object.fromEntries((subVarietyResults[0] || []).map(sv => [sv.sv_id, sv.subvariety]));
    const addSubVarietyMap = Object.fromEntries((addSubVarietyResults[0] || []).map(sv => [sv.asv_id, sv.asubvariety]));

    // Enrich results
    results.forEach(row => {
      row.cropname1 = cropMap1[row.ccode1] || '';
      row.cropname2 = cropMap2[row.ccode2] || '';
      row.cropname3 = cropMap3[row.ccode3] || '';
      row.cropname = cropMap[row.ccode] || '';
      row.cropname6 = addCropMap[row.accode] || '';
      
      row.variety1 = varietyMap1[row.v_id1] || '';
      row.variety2 = varietyMap2[row.v_id2] || '';
      row.variety3 = varietyMap3[row.v_id3] || '';
      row.variety = varietyMap[row.v_id] || '';
      row.variety6 = addVarietyMap[row.av_id] || '';
      
      row.subvariety1 = subVarietyMap1[row.sv_id1] || '';
      row.subvariety2 = subVarietyMap2[row.sv_id2] || '';
      row.subvariety3 = subVarietyMap3[row.sv_id3] || '';
      row.subvariety = subVarietyMap[row.sv_id] || '';
      row.subvariety6 = addSubVarietyMap[row.asv_id] || '';
    });
  } catch (error) {
    console.error('Error in enrichCropData:', error);
    // Don't throw - just log the error and continue
  }
}

app.get('/api/geo/all', (req, res) => {
  const cacheKey = 'geo_all_data';
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    return res.json({
      success: true,
      data: cachedData,
      cached: true,
      timestamp: new Date().toISOString()
    });
  }

  // Use simpler queries without JOINs
  const queries = {
    states: 'SELECT state_scode, state_sname FROM state',
    districts: 'SELECT district_dcode, district_dname, state_scode FROM district',
    locations: 'SELECT location_lcode, location_lname, district_dcode, state_scode FROM location',
    clusters: 'SELECT cluster_ccode, cluster_cname, location_lcode, district_dcode, state_scode FROM cluster',
    groups: 'SELECT group_gcode, group_cname, cluster_ccode, location_lcode, district_dcode, state_scode FROM grp'
  };

  Promise.all([
    new Promise((resolve) => pool.query(queries.states, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.districts, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.locations, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.clusters, (err, results) => resolve(results || []))),
    new Promise((resolve) => pool.query(queries.groups, (err, results) => resolve(results || [])))
  ])
  .then(([states, districts, locations, clusters, groups]) => {
    const data = { states, districts, locations, clusters, groups };
    
    // Cache for 1 hour
    cache.set(cacheKey, data, 3600);
    
    res.json({
      success: true,
      data: data,
      cached: false,
      timestamp: new Date().toISOString()
    });
  })
  .catch(err => {
    console.error('Error fetching geographic data:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Error fetching geographic data' 
    });
  });
});
// ==========
// ================================
// Clear cache (call this after data updates)
// ==========================================
app.post('/api/clear-cache', (req, res) => {
  dataCache.flushAll();
  console.log('Cache cleared');
  res.json({ message: 'Cache cleared successfully' });
});


// Add this to your server.js - COMPLETE CHART DATA ENDPOINT


// ==========================================
// HIERARCHY API - STATES
// ==========================================
app.get('/api/hierarchy/states', async (req, res) => {
  try {
    const cacheKey = 'hierarchy_states';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        s.state_scode,
        s.state_sname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.district_dcode) as district_count
      FROM state s
      LEFT JOIN myfarmers_data m ON s.state_scode = m.state_scode
      GROUP BY s.state_scode, s.state_sname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('States error:', error);
    res.status(500).json({ error: 'Failed to fetch states' });
  }
});

// ==========================================
// HIERARCHY API - DISTRICTS
// ==========================================
app.get('/api/hierarchy/districts/:state_scode', async (req, res) => {
  const { state_scode } = req.params;
  try {
    const cacheKey = `hierarchy_districts_${state_scode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        d.district_dcode,
        d.district_dname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.location_lcode) as location_count,
        COUNT(DISTINCT m.cluster_ccode) as cluster_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM district d
      LEFT JOIN myfarmers_data m 
        ON m.district_dcode = d.district_dcode 
        AND m.state_scode = d.state_scode
      WHERE d.state_scode = ?
      GROUP BY d.district_dcode, d.district_dname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [state_scode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Districts error:', error);
    res.status(500).json({ error: 'Failed to fetch districts' });
  }
});

// ==========================================
// HIERARCHY API - LOCATIONS
// ==========================================
app.get('/api/hierarchy/locations/:district_dcode', async (req, res) => {
  const { district_dcode } = req.params;
  try {
    const cacheKey = `hierarchy_locations_${district_dcode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        l.location_lcode,
        l.location_lname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.cluster_ccode) as cluster_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM location l
      LEFT JOIN myfarmers_data m 
        ON m.location_lcode = l.location_lcode 
        AND m.district_dcode = l.district_dcode
      WHERE l.district_dcode = ?
      GROUP BY l.location_lcode, l.location_lname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [district_dcode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ==========================================
// HIERARCHY API - CLUSTERS
// ==========================================
app.get('/api/hierarchy/clusters/:location_lcode', async (req, res) => {
  const { location_lcode } = req.params;
  try {
    const cacheKey = `hierarchy_clusters_${location_lcode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        c.cluster_ccode,
        c.cluster_cname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM cluster c
      LEFT JOIN myfarmers_data m 
        ON m.cluster_ccode = c.cluster_ccode 
        AND m.location_lcode = c.location_lcode
      WHERE c.location_lcode = ?
      GROUP BY c.cluster_ccode, c.cluster_cname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [location_lcode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Clusters error:', error);
    res.status(500).json({ error: 'Failed to fetch clusters' });
  }
});

// ==========================================
// HIERARCHY API - GROUPS
// ==========================================
/*
app.get('/api/hierarchy/groups/:cluster_ccodeapi/hierarchy/groups/:cluster_ccode', async (req, res) => {
  const { cluster_ccode } = req.params;
  try {
    const cacheKey = `hierarchy_groups_${cluster_ccode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        g.group_gcode,
        g.group_cname as name,
        COUNT(CASE WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 1 END) as member_count,
        COUNT(CASE WHEN m.member_mcode IS NULL OR TRIM(m.member_mcode) = '' THEN 1 END) as non_member_count
      FROM grp g
      LEFT JOIN myfarmers_data m 
        ON m.group_gcode = g.group_gcode 
        AND m.cluster_ccode = g.cluster_ccode
      WHERE g.cluster_ccode = ?
      GROUP BY g.group_gcode, g.group_cname
      HAVING member_count > 0 OR non_member_count > 0
      ORDER BY member_count DESC
    `, [cluster_ccode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});
*/

// ==========================================
// HIERARCHY API - GROUPS (CORRECTED)
// ==========================================
app.get('/api/hierarchy/groups/:cluster_ccode', async (req, res) => {
  const { cluster_ccode } = req.params;

  try {
    const cacheKey = `hierarchy_groups_${cluster_ccode}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const [results] = await poolPromise.query(`
      SELECT
        m.group_gcode,
        COALESCE(g.group_cname, m.group_gcode) AS name,

        SUM(
          CASE
            WHEN m.member_mcode IS NOT NULL
              AND TRIM(m.member_mcode) <> ''
              AND TRIM(m.member_mcode) <> '0'
              AND UPPER(TRIM(m.member_mcode)) <> 'NULL'
            THEN 1
            ELSE 0
          END
        ) AS member_count,

        SUM(
          CASE
            WHEN m.member_mcode IS NULL
              OR TRIM(m.member_mcode) = ''
              OR TRIM(m.member_mcode) = '0'
              OR UPPER(TRIM(m.member_mcode)) = 'NULL'
            THEN 1
            ELSE 0
          END
        ) AS non_member_count

      FROM myfarmers_data m
      LEFT JOIN grp g
        ON g.group_gcode = m.group_gcode

      WHERE m.cluster_ccode = ?
        AND m.group_gcode IS NOT NULL
        AND TRIM(m.group_gcode) <> ''

      GROUP BY
        m.group_gcode,
        g.group_cname

      ORDER BY
        member_count DESC,
        non_member_count DESC,
        name ASC
    `, [cluster_ccode]);

    cache.set(cacheKey, results, 300);

    res.json(results);

  } catch (error) {
    console.error('Groups error:', error);
    res.status(500).json({
      error: 'Failed to fetch groups'
    });
  }
});
// ==========================================
// HIERARCHY API - MEMBERS
// ==========================================
// ==========================================
// HIERARCHY API - MEMBERS (Complete with all fields)
// ==========================================
app.get('/api/hierarchy/members/:group_gcode', async (req, res) => {
  const { group_gcode } = req.params;
  try {
    const [results] = await poolPromise.query(`
      SELECT 
        m.id,
        m.farmerName,
        m.member_mcode,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.isMemberinFPO,
        m.mgnrega,
        m.aadharNumber,
        m.doorNo,
        m.street,
        m.spouseName,
        m.fatherName,
        m.datebirth,
        m.alternateNumber,
        m.stock_insurance_enrollment,
        m.latitude,
        m.longitude,
        m.irrigationType,
        m.totalAcresinTankfed,
        m.totalAcresinRainfed,
        m.totalAcresinBorewell,
        m.NoofLivestockCow,
        m.NoofLivestockBuffalow,
        m.NoofLivestockGoat,
        m.NoofLivestockSheep,
        CASE 
          WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 'Member'
          WHEN m.nonmembername IS NOT NULL AND TRIM(m.nonmembername) != '' THEN 'Non-Member'
          ELSE 'Unknown'
        END as member_type,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.group_gcode = ?
      ORDER BY 
        CASE 
          WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 0 
          ELSE 1 
        END,
        m.id ASC
    `, [group_gcode]);
    res.json(results);
  } catch (error) {
    console.error('Members error:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ==========================================
// HIERARCHY API - NON-MEMBERS
// ==========================================
app.get('/api/hierarchy/nonmembers/:group_gcode', async (req, res) => {
  const { group_gcode } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [results] = await poolPromise.query(`
      SELECT 
        m.id,
        m.farmerName,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.aadharNumber,
        m.doorNo,
        m.street,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.group_gcode = ?
        AND (m.member_mcode IS NULL OR TRIM(m.member_mcode) = '')
      ORDER BY m.id
      LIMIT ? OFFSET ?
    `, [group_gcode, parseInt(limit), offset]);

    const [countResult] = await poolPromise.query(`
      SELECT COUNT(*) as total 
      FROM myfarmers_data 
      WHERE group_gcode = ?
        AND (member_mcode IS NULL OR TRIM(member_mcode) = '')
    `, [group_gcode]);

    res.json({
      data: results,
      total: countResult[0]?.total || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((countResult[0]?.total || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('Non-members error:', error);
    res.status(500).json({ error: 'Failed to fetch non-members' });
  }
});


// 6. GET MEMBER DETAILS by ID
app.get('/api/hierarchy/member/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT 
        m.*,
        s.state_sname,
        d.district_dname,
        l.location_lname,
        c.cluster_cname,
        g.group_cname
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.id = ?
    `;
    
    const [results] = await pool.promise().query(query, [id]);
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json(results[0]);
  } catch (error) {
    console.error('Member details error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// ==========================================
// COMPLETE WORKING PAGINATED ENDPOINT WITH FILTERS
// ==========================================
app.get('/api/farmers/enriched/paginated', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
 
    const {
      state_sname, district_name, location_name, cluster_name, group_name,
      member_mcode, nonmembername, gender, fpo, mgnrega, search
    } = req.query;
 
    const where = [];
    const params = [];
 
    if (state_sname) { where.push('s.state_sname = ?'); params.push(state_sname); }
    if (district_name) { where.push('d.district_dname = ?'); params.push(district_name); }
    if (location_name) { where.push('l.location_lname = ?'); params.push(location_name); }
    if (cluster_name) { where.push('c.cluster_cname = ?'); params.push(cluster_name); }
    if (group_name) { where.push('g.group_cname = ?'); params.push(group_name); }
    if (member_mcode) { where.push('m.member_mcode LIKE ?'); params.push(`%${member_mcode}%`); }
    if (nonmembername) { where.push('m.nonmembername LIKE ?'); params.push(`%${nonmembername}%`); }
    if (gender) { where.push('LOWER(m.gender) = LOWER(?)'); params.push(gender); }
    if (fpo === 'yes') { where.push("LOWER(m.isMemberinFPO) = 'yes'"); }
    if (mgnrega === 'yes') { where.push("LOWER(m.mgnrega) = 'yes'"); }
    if (search) {
      where.push('(m.farmerName LIKE ? OR m.member_mcode LIKE ? OR m.nonmembername LIKE ? OR m.farmerMobile LIKE ?)');
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }
 
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
 
    // Lightweight count — only the joins the WHERE clause actually needs.
    const countQuery = `
      SELECT COUNT(*) as total
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      ${whereClause}
    `;
    const [countResult] = await poolPromise.query(countQuery, params);
    const total = countResult[0].total;
 
    // Full data query — same geography joins PLUS crop and livestock joins.
    // Livestock fields (NoofLivestockCow, VarietyBreadCow, etc.) live directly
    // on myfarmers_data, so they need no join at all — just select them.
    const dataQuery = `
      SELECT
        m.id, m.farmerName, m.gender, m.age, m.member_mcode, m.nonmembername,
        m.isMemberinFPO, m.nameoftheFPO, m.mgnrega, m.farmerMobile,
 
        m.irrigationType, m.areaofCultivationinTankfed,
        m.lastyearyields1, m.category1,
        m.irrigationtyperainfed, m.areaofCultivationinRainfed,
        m.lastyearyields2, m.category2,
        m.irrigationtypeborewell, m.areaofCultivationinBorewell,
        m.lastyearyields3, m.category3,
        m.irrigationtypedrip, m.areaofCultivationinDripOpenWellCanalIrrigation,
        m.lastyearyields, m.category4,
 
        cm1.cname as cropname1, cv1.cvariety as variety1, csv1.subvariety as subvariety1,
        cm2.cname as cropname2, cv2.cvariety as variety2, csv2.subvariety as subvariety2,
        cm3.cname as cropname3, cv3.cvariety as variety3, csv3.subvariety as subvariety3,
        cm.cname as cropname, cv.cvariety as variety, csv.subvariety as subvariety,
        acm.acname as cropname6, acv.acvariety as variety6, acsv.asubvariety as subvariety6,
 
        m.NoofLivestockCow, m.VarietyBreadCow, m.FeedingTypeCow, m.WhetherFodderCultivatedCow,
        m.NoofMilkYieldingAnimalCow, m.MilkYieldDayAnimalCow, m.FrequencyofSalesCow,
        m.AverageIncomeCow, m.NearbyVeterinaryHospitalCow, m.AnyseasonaldiseaseoutbreakCow,
        m.TreatmentMethodFollowedCow,
 
        m.NoofLivestockBuffalow, m.VarietyBreadBuffalow, m.FeedingTypeBuffalow, m.WhetherFodderCultivatedBuffalow,
        m.NoofMilkYieldingAnimalBuffalow, m.MilkYieldDayAnimalBuffalow, m.FrequencyofSalesBuffalow,
        m.AverageIncomeBuffalow, m.NearbyVeterinaryHospitalBuffalow, m.AnyseasonaldiseaseoutbreakBuffalow,
        m.TreatmentMethodFollowedBuffalow,
 
        m.NoofLivestockGoat, m.VarietyBreadGoat, m.FeedingTypeGoat, m.WhetherFodderCultivatedGoat,
        m.NoofMilkYieldingAnimalGoat, m.MilkYieldDayAnimalGoat, m.FrequencyofSalesGoat,
        m.AverageIncomeGoat, m.NearbyVeterinaryHospitalGoat, m.AnyseasonaldiseaseoutbreakGoat,
        m.TreatmentMethodFollowedGoat,
 
        m.NoofLivestockSheep, m.VarietyBreadSheep, m.FeedingTypeSheep, m.WhetherFodderCultivatedSheep,
        m.NoofMilkYieldingAnimalSheep, m.MilkYieldDayAnimalSheep, m.FrequencyofSalesSheep,
        m.AverageIncomeSheep, m.NearbyVeterinaryHospitalSheep, m.AnyseasonaldiseaseoutbreakSheep,
        m.TreatmentMethodFollowedSheep,
 
        COALESCE(s.state_sname,'') as state_sname,
        COALESCE(d.district_dname,'') as district_name,
        COALESCE(l.location_lname,'') as location_name,
        COALESCE(c.cluster_cname,'') as cluster_name,
        COALESCE(g.group_cname,'') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      LEFT JOIN cropmaster1 cm1 ON m.ccode1 = cm1.ccode1
      LEFT JOIN cropvariety1 cv1 ON m.ccode1 = cv1.ccode1 AND m.v_id1 = cv1.v_id1
      LEFT JOIN cropsubvariety1 csv1 ON m.sv_id1 = csv1.sv_id1
      LEFT JOIN cropmaster2 cm2 ON m.ccode2 = cm2.ccode2
      LEFT JOIN cropvariety2 cv2 ON m.ccode2 = cv2.ccode2 AND m.v_id2 = cv2.v_id2
      LEFT JOIN cropsubvariety2 csv2 ON m.sv_id2 = csv2.sv_id2
      LEFT JOIN cropmaster3 cm3 ON m.ccode3 = cm3.ccode3
      LEFT JOIN cropvariety3 cv3 ON m.ccode3 = cv3.ccode3 AND m.v_id3 = cv3.v_id3
      LEFT JOIN cropsubvariety3 csv3 ON m.sv_id3 = csv3.sv_id3
      LEFT JOIN cropmaster cm ON m.ccode = cm.ccode
      LEFT JOIN cropvariety cv ON m.ccode = cv.ccode AND m.v_id = cv.v_id
      LEFT JOIN cropsubvariety csv ON m.sv_id = csv.sv_id
      LEFT JOIN addcropmaster acm ON m.accode = acm.accode
      LEFT JOIN addcropvariety acv ON m.accode = acv.accode AND m.av_id = acv.av_id
      LEFT JOIN addcropsubvariety acsv ON m.asv_id = acsv.asv_id
      ${whereClause}
      ORDER BY m.id
      LIMIT ? OFFSET ?
    `;
 
    const [results] = await poolPromise.query(dataQuery, [...params, limit, offset]);
 
    const dataWithSno = results.map((row, index) => ({ ...row, sno: offset + index + 1 }));
 
    res.json({ data: dataWithSno, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Paginated enriched error:', error);
    res.status(500).json({ error: error.message });
  }
});
 


 

app.get('/api/filter-options', async (req, res) => {
    const { state_sname, district_name, location_name } = req.query;
    
    // Example query for Districts based on State
    const states = await pool.promise().query("SELECT DISTINCT state_sname FROM state ORDER BY state_sname");
    
    let districtSql = "SELECT DISTINCT district_dname FROM district d JOIN state s ON d.state_scode = s.state_scode";
    if (state_sname) districtSql += ` WHERE s.state_sname = '${state_sname}'`;
    const districts = await pool.promise().query(districtSql);

    res.json({
        states: states[0].map(r => r.state_sname),
        districts: districts[0].map(r => r.district_dname),
        // Add similar logic for locations, clusters, etc.
    });
});
// ==========================================
// DRILL-DOWN HIERARCHY API ENDPOINTS
// ==========================================


// ==========================================
// ULTRA-FAST MEMBERS TABLE ENDPOINT
// ==========================================
// ==========================================
// SIMPLIFIED FAST MEMBERS TABLE ENDPOINT
// ==========================================

app.get('/api/members/fast', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const {
      search, filterKey, filterValue,
      state_scode, district_dcode, location_lcode, cluster_ccode, group_gcode,
      member_type
    } = req.query;

    console.log('📊 /members/fast query:', req.query); // TEMP DEBUG — remove later

    const where = [];
    const params = [];

    switch (filterKey) {
      case 'fpo': where.push("LOWER(m.isMemberinFPO) = 'yes'"); break;
      case 'mgnrega': where.push("LOWER(m.mgnrega) = 'yes'"); break;
      case 'livestock':
        where.push(`(
          COALESCE(CAST(m.NoofLivestockCow AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.NoofLivestockBuffalow AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.NoofLivestockGoat AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.NoofLivestockSheep AS DECIMAL), 0) > 0
        )`);
        break;
      case 'irrigation_all':
        where.push(`(
          COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL), 0) > 0 OR
          COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0
        )`);
        break;
      case 'irrigation':
        if (filterValue === 'Tankfed')  where.push('COALESCE(CAST(m.totalAcresinTankfed AS DECIMAL),0) > 0');
        if (filterValue === 'Rainfed')  where.push('COALESCE(CAST(m.totalAcresinRainfed AS DECIMAL),0) > 0');
        if (filterValue === 'Borewell') where.push('COALESCE(CAST(m.totalAcresinBorewell AS DECIMAL),0) > 0');
        if (filterValue === 'Drip')     where.push('COALESCE(CAST(m.totalAcresinDripOpenWellCanalIrrigation AS DECIMAL),0) > 0');
        break;
      case 'yield': {
        const y = `GREATEST(
          COALESCE(CAST(m.lastyearyields1 AS DECIMAL),0),
          COALESCE(CAST(m.lastyearyields2 AS DECIMAL),0),
          COALESCE(CAST(m.lastyearyields3 AS DECIMAL),0)
        )`;
        if (filterValue === 'Aspirant')      where.push(`${y} > 0 AND ${y} < 2500`);
        if (filterValue === 'Performer')     where.push(`${y} >= 2500 AND ${y} < 2600`);
        if (filterValue === 'Front Runner')  where.push(`${y} >= 2600 AND ${y} < 2800`);
        if (filterValue === 'Bench Marker')  where.push(`${y} >= 2800`);
        if (filterValue === 'No Yield Data') where.push(`${y} = 0`);
        break;
      }
      case 'farming_only':
        where.push(`(
          (m.soilType1 IS NOT NULL AND TRIM(m.soilType1) != '') OR
          (m.soilType2 IS NOT NULL AND TRIM(m.soilType2) != '') OR
          (m.soilType3 IS NOT NULL AND TRIM(m.soilType3) != '') OR
          (m.soilType  IS NOT NULL AND TRIM(m.soilType)  != '')
        ) AND (
          (m.FeedingTypeCow      IS NULL OR TRIM(m.FeedingTypeCow)      = '') AND
          (m.FeedingTypeBuffalow IS NULL OR TRIM(m.FeedingTypeBuffalow) = '') AND
          (m.FeedingTypeGoat     IS NULL OR TRIM(m.FeedingTypeGoat)     = '') AND
          (m.FeedingTypeSheep    IS NULL OR TRIM(m.FeedingTypeSheep)    = '')
        )`);
        break;
      case 'livestock_only':
        where.push(`(
          (m.FeedingTypeCow      IS NOT NULL AND TRIM(m.FeedingTypeCow)      != '') OR
          (m.FeedingTypeBuffalow IS NOT NULL AND TRIM(m.FeedingTypeBuffalow) != '') OR
          (m.FeedingTypeGoat     IS NOT NULL AND TRIM(m.FeedingTypeGoat)     != '') OR
          (m.FeedingTypeSheep    IS NOT NULL AND TRIM(m.FeedingTypeSheep)    != '')
        ) AND (
          (m.soilType1 IS NULL OR TRIM(m.soilType1) = '') AND
          (m.soilType2 IS NULL OR TRIM(m.soilType2) = '') AND
          (m.soilType3 IS NULL OR TRIM(m.soilType3) = '') AND
          (m.soilType  IS NULL OR TRIM(m.soilType)  = '')
        )`);
        break;
      case 'both':
        where.push(`(
          (m.soilType1 IS NOT NULL AND TRIM(m.soilType1) != '') OR
          (m.soilType2 IS NOT NULL AND TRIM(m.soilType2) != '') OR
          (m.soilType3 IS NOT NULL AND TRIM(m.soilType3) != '') OR
          (m.soilType  IS NOT NULL AND TRIM(m.soilType)  != '')
        ) AND (
          (m.FeedingTypeCow      IS NOT NULL AND TRIM(m.FeedingTypeCow)      != '') OR
          (m.FeedingTypeBuffalow IS NOT NULL AND TRIM(m.FeedingTypeBuffalow) != '') OR
          (m.FeedingTypeGoat     IS NOT NULL AND TRIM(m.FeedingTypeGoat)     != '') OR
          (m.FeedingTypeSheep    IS NOT NULL AND TRIM(m.FeedingTypeSheep)    != '')
        )`);
        break;
      case 'alt_livelihoods':
        where.push(`(
          (m.soilType1 IS NULL OR TRIM(m.soilType1) = '') AND
          (m.soilType2 IS NULL OR TRIM(m.soilType2) = '') AND
          (m.soilType3 IS NULL OR TRIM(m.soilType3) = '') AND
          (m.soilType  IS NULL OR TRIM(m.soilType)  = '')
        ) AND (
          (m.FeedingTypeCow      IS NULL OR TRIM(m.FeedingTypeCow)      = '') AND
          (m.FeedingTypeBuffalow IS NULL OR TRIM(m.FeedingTypeBuffalow) = '') AND
          (m.FeedingTypeGoat     IS NULL OR TRIM(m.FeedingTypeGoat)     = '') AND
          (m.FeedingTypeSheep    IS NULL OR TRIM(m.FeedingTypeSheep)    = '')
        )`);
        break;
      case 'gender':
        if (filterValue === 'other') {
          where.push("LOWER(m.gender) NOT IN ('male','female') AND m.gender IS NOT NULL AND TRIM(m.gender) != ''");
        } else if (filterValue) {
          where.push('LOWER(m.gender) = ?');
          params.push(filterValue.toLowerCase());
        }
        break;
      default: break;
    }

    if (state_scode)    { where.push('m.state_scode = ?');    params.push(state_scode); }
    if (district_dcode) { where.push('m.district_dcode = ?'); params.push(district_dcode); }
    if (location_lcode) { where.push('m.location_lcode = ?'); params.push(location_lcode); }
    if (cluster_ccode)  { where.push('m.cluster_ccode = ?');  params.push(cluster_ccode); }
    if (group_gcode)    { where.push('m.group_gcode = ?');    params.push(group_gcode); }

    if (member_type === 'member') {
      where.push("m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != ''");
    } else if (member_type === 'nonmember') {
      where.push("(m.member_mcode IS NULL OR TRIM(m.member_mcode) = '') AND m.nonmembername IS NOT NULL AND TRIM(m.nonmembername) != ''");
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      where.push(`(m.farmerName LIKE ? OR m.member_mcode LIKE ? OR m.nonmembername LIKE ? OR m.farmerMobile LIKE ?)`);
      params.push(s, s, s, s);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    console.log('📊 SQL WHERE:', whereClause, params); // TEMP DEBUG — remove later

    const countQuery = `SELECT COUNT(*) as total FROM myfarmers_data m ${whereClause}`;
    const [countResult] = await poolPromise.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    const dataQuery = `
      SELECT
        m.id, m.farmerName, m.member_mcode, m.nonmembername,
        m.gender, m.age, m.farmerMobile, m.isMemberinFPO, m.mgnrega,
        COALESCE(s.state_sname, '')     as state_sname,
        COALESCE(d.district_dname, '')  as district_name,
        COALESCE(l.location_lname, '')  as location_name,
        COALESCE(c.cluster_cname, '')   as cluster_name,
        COALESCE(g.group_cname, '')     as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      ${whereClause}
      ORDER BY m.id ASC
      LIMIT ? OFFSET ?
    `;
    const [results] = await poolPromise.query(dataQuery, [...params, limit, offset]);

    console.log(`📊 Returned ${results.length} of ${total} total`); // TEMP DEBUG

    return res.json({
      success: true,
      data: results.map((row, i) => ({ ...row, sno: offset + i + 1 })),
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalRecords: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('members/fast error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load members. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/fast-farmers', async (req, res) => {
  try {
    // Querying the VIEW instead of the TABLE
    const [rows] = await db.query("SELECT * FROM v_farmers_master_fast");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Start server

// ==========================================
// DASHBOARD HIERARCHY DATA
// ==========================================
app.get('/api/hierarchy/dashboard', async (req, res) => {
  try {
    const cacheKey = 'hierarchy_dashboard';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [states] = await poolPromise.query(`
      SELECT 
        s.state_scode,
        s.state_sname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.district_dcode) as district_count,
        COUNT(DISTINCT m.location_lcode) as location_count,
        COUNT(DISTINCT m.cluster_ccode) as cluster_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM state s
      LEFT JOIN myfarmers_data m ON s.state_scode = m.state_scode
      GROUP BY s.state_scode, s.state_sname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `);

    const response = { states };
    cache.set(cacheKey, response, 300);
    res.json(response);
  } catch (error) {
    console.error('Dashboard hierarchy error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});
app.get('/api/admin-summary', (req, res) => {
    const mainQuery = `
    SELECT 
        COUNT(DISTINCT id) as total,
        SUM(IF(LOWER(isMemberinFPO) = 'yes', 1, 0)) as fpo,
        SUM(IF(LOWER(mgnrega) = 'yes', 1, 0)) as mgnrega,
        SUM(COALESCE(NoofLivestockCow,0) + COALESCE(NoofLivestockBuffalow,0) + COALESCE(NoofLivestockGoat,0) + COALESCE(NoofLivestockSheep,0)) as totalLivestock,
        
        -- IRRIGATION FARMERS (Exact 39,519)
        SUM(IF(totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0, 1, 0)) as totalIrrigationFarmers,
        
        -- ACTIVITY CATEGORIES
        SUM(IF((totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0 OR ccode1 IS NOT NULL) AND (COALESCE(NoofLivestockCow,0)+COALESCE(NoofLivestockBuffalow,0)+COALESCE(NoofLivestockGoat,0)+COALESCE(NoofLivestockSheep,0) > 0), 1, 0)) as both,
        SUM(IF((totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0 OR ccode1 IS NOT NULL) AND NOT (COALESCE(NoofLivestockCow,0)+COALESCE(NoofLivestockBuffalow,0)+COALESCE(NoofLivestockGoat,0)+COALESCE(NoofLivestockSheep,0) > 0), 1, 0)) as farmingOnly,
        SUM(IF(NOT (totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0 OR ccode1 IS NOT NULL) AND (COALESCE(NoofLivestockCow,0)+COALESCE(NoofLivestockBuffalow,0)+COALESCE(NoofLivestockGoat,0)+COALESCE(NoofLivestockSheep,0) > 0), 1, 0)) as livestockOnly,
        SUM(IF(NOT (totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0 OR ccode1 IS NOT NULL) AND NOT (COALESCE(NoofLivestockCow,0)+COALESCE(NoofLivestockBuffalow,0)+COALESCE(NoofLivestockGoat,0)+COALESCE(NoofLivestockSheep,0) > 0), 1, 0)) as alternativeLivelihoods,

        -- YIELD (Exact counts for the Irrigation Subset)
        SUM(IF((totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0) AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) > 0 AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) < 2500, 1, 0)) as yieldAspirant,
        SUM(IF((totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0) AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) >= 2800, 1, 0)) as yieldBench,
        SUM(IF((totalAcresinTankfed > 0 OR totalAcresinRainfed > 0 OR totalAcresinBorewell > 0 OR totalAcresinDripOpenWellCanalIrrigation > 0) AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) = 0, 1, 0)) as yieldNone,

        AVG(IF(age > 0, age, NULL)) as avgAge
    FROM myfarmers_data;`;

    pool.query(mainQuery, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0]);
    });
});
// ==========================================
// 2. GEOGRAPHY STATS (FAST)
// ==========================================
app.get('/api/dashboard/geography', async (req, res) => {
  try {
    console.time('dashboard-geography-query');
    
    const query = `
      SELECT 
        s.state_scode,
        s.state_sname as name,
        COUNT(DISTINCT m.district_dcode) as regionCount,
        COUNT(m.id) as value,
        GROUP_CONCAT(DISTINCT d.district_dname ORDER BY d.district_dname LIMIT 3) as districtNames
      FROM state s
      LEFT JOIN myfarmers_data m ON s.state_scode = m.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      GROUP BY s.state_scode, s.state_sname
      ORDER BY COUNT(m.id) DESC
    `;

    pool.query(query, (err, results) => {
      console.timeEnd('dashboard-geography-query');
      
      if (err) {
        console.error('Geography stats error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      const geography = results.map(row => ({
        name: row.name,
        value: row.value || 0,
        scode: row.state_scode,
        regionCount: row.regionCount || 0,
        districtNames: row.districtNames ? row.districtNames.split(',') : []
      }));
      
      res.json(geography);
    });
    
  } catch (error) {
    console.error('Geography stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
// 3. PAGINATED FARMERS DATA
// ==========================================
app.get('/api/farmers/paginated', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  
  console.time(`paginated-farmers-${page}-${limit}`);
  
  // Get minimal fields only for table view
  const query = `
    SELECT 
      id, farmerName, gender, age, state_scode, district_dcode,
      isMemberinFPO, mgnrega, irrigationType,
      totalAcresinTankfed, totalAcresinRainfed, 
      totalAcresinBorewell, totalAcresinDripOpenWellCanalIrrigation,
      NoofLivestockCow, NoofLivestockBuffalow, NoofLivestockGoat, NoofLivestockSheep,
      lastyearyields1, lastyearyields2, lastyearyields3
    FROM myfarmers_data 
    LIMIT ? OFFSET ?
  `;
  
  pool.query(query, [limit, offset], (err, results) => {
    if (err) {
      console.error('Paginated farmers error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Get total count in parallel
    pool.query('SELECT COUNT(*) as total FROM myfarmers_data', (err2, countResult) => {
      console.timeEnd(`paginated-farmers-${page}-${limit}`);
      
      if (err2) {
        console.error('Count error:', err2);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        data: results,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
      });
    });
  });
});



// ==========================================
// HIERARCHY API - STATES
// ==========================================
app.get('/api/hierarchy/states', async (req, res) => {
  try {
    const cacheKey = 'hierarchy_states';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        s.state_scode,
        s.state_sname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.district_dcode) as district_count
      FROM state s
      LEFT JOIN myfarmers_data m ON s.state_scode = m.state_scode
      GROUP BY s.state_scode, s.state_sname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('States error:', error);
    res.status(500).json({ error: 'Failed to fetch states' });
  }
});

// ==========================================
// HIERARCHY API - DISTRICTS
// ==========================================
app.get('/api/hierarchy/districts/:state_scode', async (req, res) => {
  const { state_scode } = req.params;
  try {
    const cacheKey = `hierarchy_districts_${state_scode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        d.district_dcode,
        d.district_dname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.location_lcode) as location_count,
        COUNT(DISTINCT m.cluster_ccode) as cluster_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM district d
      LEFT JOIN myfarmers_data m 
        ON m.district_dcode = d.district_dcode 
        AND m.state_scode = d.state_scode
      WHERE d.state_scode = ?
      GROUP BY d.district_dcode, d.district_dname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [state_scode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Districts error:', error);
    res.status(500).json({ error: 'Failed to fetch districts' });
  }
});

// ==========================================
// HIERARCHY API - LOCATIONS
// ==========================================
app.get('/api/hierarchy/locations/:district_dcode', async (req, res) => {
  const { district_dcode } = req.params;
  try {
    const cacheKey = `hierarchy_locations_${district_dcode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        l.location_lcode,
        l.location_lname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.cluster_ccode) as cluster_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM location l
      LEFT JOIN myfarmers_data m 
        ON m.location_lcode = l.location_lcode 
        AND m.district_dcode = l.district_dcode
      WHERE l.district_dcode = ?
      GROUP BY l.location_lcode, l.location_lname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [district_dcode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// ==========================================
// HIERARCHY API - CLUSTERS
// ==========================================
app.get('/api/hierarchy/clusters/:location_lcode', async (req, res) => {
  const { location_lcode } = req.params;
  try {
    const cacheKey = `hierarchy_clusters_${location_lcode}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [results] = await poolPromise.query(`
      SELECT 
        c.cluster_ccode,
        c.cluster_cname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(DISTINCT m.group_gcode) as group_count
      FROM cluster c
      LEFT JOIN myfarmers_data m 
        ON m.cluster_ccode = c.cluster_ccode 
        AND m.location_lcode = c.location_lcode
      WHERE c.location_lcode = ?
      GROUP BY c.cluster_ccode, c.cluster_cname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [location_lcode]);

    cache.set(cacheKey, results, 300);
    res.json(results);
  } catch (error) {
    console.error('Clusters error:', error);
    res.status(500).json({ error: 'Failed to fetch clusters' });
  }
});

// ==========================================
// HIERARCHY API - GROUPS
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (FIXED)
// ==========================================
// GET GROUPS FOR A CLUSTER
/*
app.get('/api/hierarchy/groups/:cluster_ccode', async (req, res) => {
  const { cluster_ccode } = req.params;
  try {
    const [results] = await poolPromise.query(`
      SELECT 
        g.group_gcode,
        g.group_cname as name,
        COUNT(DISTINCT m.id) as member_count,
        COUNT(CASE WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 1 END) as members_with_code,
        COUNT(CASE WHEN (m.member_mcode IS NULL OR TRIM(m.member_mcode) = '') 
                    AND m.nonmembername IS NOT NULL 
                    AND TRIM(m.nonmembername) != '' THEN 1 END) as non_members
      FROM grp g
      LEFT JOIN myfarmers_data m 
        ON m.group_gcode = g.group_gcode 
        AND m.cluster_ccode = g.cluster_ccode
      WHERE g.cluster_ccode = ?
      GROUP BY g.group_gcode, g.group_cname
      HAVING member_count > 0
      ORDER BY member_count DESC
    `, [cluster_ccode]);
    res.json(results);
  } catch (error) {
    console.error('Groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});
*/

// ==========================================
// HIERARCHY API - MEMBERS (FIXED)
// ==========================================
app.get('/api/hierarchy/members/:group_gcode', async (req, res) => {
  const { group_gcode } = req.params;
  try {
    const [results] = await poolPromise.query(`
      SELECT 
        m.id,
        m.farmerName,
        m.member_mcode,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.isMemberinFPO,
        m.mgnrega,
        m.aadharNumber,
        m.doorNo,
        m.street,
        m.spouseName,
        m.fatherName,
        m.datebirth,
        m.alternateNumber,
        m.stock_insurance_enrollment,
        m.latitude,
        m.longitude,
        m.irrigationType,
        m.totalAcresinTankfed,
        m.totalAcresinRainfed,
        m.totalAcresinBorewell,
        m.NoofLivestockCow,
        m.NoofLivestockBuffalow,
        m.NoofLivestockGoat,
        m.NoofLivestockSheep,
        CASE 
          WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 'Member'
          WHEN m.nonmembername IS NOT NULL AND TRIM(m.nonmembername) != '' THEN 'Non-Member'
          ELSE 'Unknown'
        END as member_type,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.group_gcode = ?
      ORDER BY 
        CASE 
          WHEN m.member_mcode IS NOT NULL AND TRIM(m.member_mcode) != '' THEN 0 
          ELSE 1 
        END,
        m.id ASC
    `, [group_gcode]);
    res.json(results);
  } catch (error) {
    console.error('Members error:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ==========================================
// HIERARCHY API - NON-MEMBERS
// ==========================================
/*
app.get('/api/hierarchy/nonmembers/:group_gcode', async (req, res) => {
  const { group_gcode } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [results] = await poolPromise.query(`
      SELECT 
        m.id,
        m.farmerName,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.aadharNumber,
        m.doorNo,
        m.street,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.group_gcode = ?
        AND (m.member_mcode IS NULL OR TRIM(m.member_mcode) = '')
      ORDER BY m.id
      LIMIT ? OFFSET ?
    `, [group_gcode, parseInt(limit), offset]);

    const [countResult] = await poolPromise.query(`
      SELECT COUNT(*) as total 
      FROM myfarmers_data 
      WHERE group_gcode = ?
        AND (member_mcode IS NULL OR TRIM(member_mcode) = '')
    `, [group_gcode]);

    res.json({
      data: results,
      total: countResult[0]?.total || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((countResult[0]?.total || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('Non-members error:', error);
    res.status(500).json({ error: 'Failed to fetch non-members' });
  }
});
*/

// ==========================================
// HIERARCHY API - GROUPS (FIXED - WITH ACCURATE NON-MEMBER COUNTS)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (FIXED - INCLUDES GROUPS WITH ONLY NON-MEMBERS)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (COMPLETE FIXED)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (FIXED - INCLUDES GROUPS WITH ONLY NON-MEMBERS)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (FIXED - NO FALSE NON-MEMBERS)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (ONLY SHOW GROUPS WITH ACTUAL RECORDS)
// ==========================================
// ==========================================
// HIERARCHY API - GROUPS (MOST ACCURATE)
// ==========================================
// HIERARCHY API - NON-MEMBERS (FIXED)
// ==========================================
app.get('/api/hierarchy/nonmembers/:group_gcode', async (req, res) => {
  const { group_gcode } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Get total count of non-members in this group
    const [countResult] = await poolPromise.query(`
      SELECT COUNT(*) as total
      FROM myfarmers_data
      WHERE group_gcode = ?
        AND (member_mcode IS NULL 
          OR TRIM(member_mcode) = '' 
          OR TRIM(member_mcode) = '0'
          OR TRIM(member_mcode) = 'NULL')
    `, [group_gcode]);

    // Get paginated non-members with their details
    const [results] = await poolPromise.query(`
      SELECT
        m.id,
        m.farmerName,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.aadharNumber,
        m.doorNo,
        m.street,
        m.member_mcode,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.group_gcode = ?
        AND (m.member_mcode IS NULL 
          OR TRIM(m.member_mcode) = '' 
          OR TRIM(m.member_mcode) = '0'
          OR TRIM(m.member_mcode) = 'NULL')
      ORDER BY m.id
      LIMIT ? OFFSET ?
    `, [group_gcode, parseInt(limit), offset]);

    res.json({
      data: results,
      total: countResult[0]?.total || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((countResult[0]?.total || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('Non-members error:', error);
    res.status(500).json({ error: 'Failed to fetch non-members' });
  }
});
// ==========================================
// API - GET ALL NON-MEMBERS IN A CLUSTER
// ==========================================
app.get('/api/hierarchy/cluster/nonmembers/:cluster_ccode', async (req, res) => {
  const { cluster_ccode } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Get total count of non-members in this cluster
    const [countResult] = await poolPromise.query(`
      SELECT COUNT(*) as total
      FROM myfarmers_data
      WHERE cluster_ccode = ?
        AND (member_mcode IS NULL 
          OR TRIM(member_mcode) = '' 
          OR TRIM(member_mcode) = '0'
          OR TRIM(member_mcode) = 'NULL')
    `, [cluster_ccode]);

    // Get paginated non-members with their details
    const [results] = await poolPromise.query(`
      SELECT
        m.id,
        m.farmerName,
        m.nonmembername,
        m.gender,
        m.age,
        m.farmerMobile,
        m.aadharNumber,
        m.doorNo,
        m.street,
        m.member_mcode,
        m.group_gcode,
        COALESCE(s.state_sname, '') as state_name,
        COALESCE(d.district_dname, '') as district_name,
        COALESCE(l.location_lname, '') as location_name,
        COALESCE(c.cluster_cname, '') as cluster_name,
        COALESCE(g.group_cname, '') as group_name
      FROM myfarmers_data m
      LEFT JOIN state s ON m.state_scode = s.state_scode
      LEFT JOIN district d ON m.district_dcode = d.district_dcode
      LEFT JOIN location l ON m.location_lcode = l.location_lcode
      LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
      LEFT JOIN grp g ON m.group_gcode = g.group_gcode
      WHERE m.cluster_ccode = ?
        AND (m.member_mcode IS NULL 
          OR TRIM(m.member_mcode) = '' 
          OR TRIM(m.member_mcode) = '0'
          OR TRIM(m.member_mcode) = 'NULL')
      ORDER BY m.id
      LIMIT ? OFFSET ?
    `, [cluster_ccode, parseInt(limit), offset]);

    res.json({
      data: results,
      total: countResult[0]?.total || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((countResult[0]?.total || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('Cluster non-members error:', error);
    res.status(500).json({ error: 'Failed to fetch non-members' });
  }
});







app.post('/api/clear-cache', (req, res) => {
  dataCache.flushAll();
  console.log('Cache cleared');
  res.json({ message: 'Cache cleared successfully' });
});
app.get('/api/dashboard/chart-data-complete', async (req, res) => {
  try {
    console.time('chart-data-complete-query');
    
    const [
      genderResult,
      ageResult,
      mgnregaResult,
      fpoResult,
      stockInsuranceResult,
      irrigationResult,
      livestockResult,
      soilTypeResult,
      yieldResult,
      cropResult
    ] = await Promise.all([
      // 1. Gender Distribution
      pool.promise().query(`
        SELECT 'Male' as name, SUM(CASE WHEN LOWER(gender) = 'male' THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Female' as name, SUM(CASE WHEN LOWER(gender) = 'female' THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Other' as name, SUM(CASE WHEN LOWER(gender) NOT IN ('male', 'female') AND gender IS NOT NULL AND TRIM(gender) != '' THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 2. Age Groups
      pool.promise().query(`
        SELECT '18-30' as name, SUM(CASE WHEN age BETWEEN 18 AND 30 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT '31-45' as name, SUM(CASE WHEN age BETWEEN 31 AND 45 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT '46-60' as name, SUM(CASE WHEN age BETWEEN 46 AND 60 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT '60+' as name, SUM(CASE WHEN age > 60 THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 3. MGNREGA Enrollment
      pool.promise().query(`
        SELECT 'Yes' as name, SUM(CASE WHEN LOWER(mgnrega) = 'yes' THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'No' as name, SUM(CASE WHEN LOWER(mgnrega) != 'yes' OR mgnrega IS NULL THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 4. FPO Membership
      pool.promise().query(`
        SELECT 'Yes' as name, SUM(CASE WHEN LOWER(isMemberinFPO) = 'yes' THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'No' as name, SUM(CASE WHEN LOWER(isMemberinFPO) != 'yes' OR isMemberinFPO IS NULL THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 5. Stock Insurance
      pool.promise().query(`
        SELECT 'Enrolled' as name, SUM(CASE WHEN LOWER(stock_insurance_enrollment) = 'yes' THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Not Enrolled' as name, SUM(CASE WHEN LOWER(stock_insurance_enrollment) != 'yes' OR stock_insurance_enrollment IS NULL THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 6. Irrigation Types
      pool.promise().query(`
        SELECT 'Tankfed' as name, SUM(CASE WHEN COALESCE(CAST(totalAcresinTankfed AS DECIMAL), 0) > 0 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Rainfed' as name, SUM(CASE WHEN COALESCE(CAST(totalAcresinRainfed AS DECIMAL), 0) > 0 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Borewell' as name, SUM(CASE WHEN COALESCE(CAST(totalAcresinBorewell AS DECIMAL), 0) > 0 THEN 1 ELSE 0 END) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Drip/Open Well/Canal' as name, SUM(CASE WHEN COALESCE(CAST(totalAcresinDripOpenWellCanalIrrigation AS DECIMAL), 0) > 0 THEN 1 ELSE 0 END) as value FROM myfarmers_data
      `),
      
      // 7. Livestock Distribution
      pool.promise().query(`
        SELECT 'Cow' as name, SUM(COALESCE(NoofLivestockCow, 0)) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Buffalo' as name, SUM(COALESCE(NoofLivestockBuffalow, 0)) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Goat' as name, SUM(COALESCE(NoofLivestockGoat, 0)) as value FROM myfarmers_data
        UNION ALL
        SELECT 'Sheep' as name, SUM(COALESCE(NoofLivestockSheep, 0)) as value FROM myfarmers_data
      `),
      
      // 8. Soil Types
      pool.promise().query(`
        SELECT soil_type as name, COUNT(*) as value 
        FROM (
          SELECT soilType1 as soil_type FROM myfarmers_data WHERE soilType1 IS NOT NULL AND TRIM(soilType1) != ''
          UNION ALL
          SELECT soilType2 as soil_type FROM myfarmers_data WHERE soilType2 IS NOT NULL AND TRIM(soilType2) != ''
          UNION ALL
          SELECT soilType3 as soil_type FROM myfarmers_data WHERE soilType3 IS NOT NULL AND TRIM(soilType3) != ''
        ) all_soils
        GROUP BY soil_type
        ORDER BY value DESC
        LIMIT 10
      `),
      
      // 9. Yield Performance Categories
      pool.promise().query(`
        SELECT 'Aspirant' as name, COUNT(*) as value FROM myfarmers_data 
        WHERE GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) > 0 
        AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) < 2500
        UNION ALL
        SELECT 'Performer' as name, COUNT(*) as value FROM myfarmers_data 
        WHERE GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) >= 2500 
        AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) < 2600
        UNION ALL
        SELECT 'Front Runner' as name, COUNT(*) as value FROM myfarmers_data 
        WHERE GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) >= 2600 
        AND GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) < 2800
        UNION ALL
        SELECT 'Bench Marker' as name, COUNT(*) as value FROM myfarmers_data 
        WHERE GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) >= 2800
        UNION ALL
        SELECT 'No Yield Data' as name, COUNT(*) as value FROM myfarmers_data 
        WHERE GREATEST(COALESCE(lastyearyields1,0), COALESCE(lastyearyields2,0), COALESCE(lastyearyields3,0)) = 0
      `),
      
      // 10. Top Crops - CORRECTED with proper CASE mapping
     // Most Used Crops - CORRECTED with proper CASE mapping and unique farmers
pool.promise().query(`
  SELECT 
      CASE all_crops.crop_code
          WHEN 'C001' THEN 'Paddy'
          WHEN 'C002' THEN 'Sorghum'
          WHEN 'C004' THEN 'Ragi'
          WHEN 'C005' THEN 'Maize'
          WHEN 'C013' THEN 'Groundnut'
          WHEN 'C003' THEN 'Cotton'
          ELSE COALESCE(
              NULLIF(TRIM(cm.cname), ''),
              NULLIF(TRIM(cm1.cname), ''),
              NULLIF(TRIM(cm2.cname), ''),
              NULLIF(TRIM(cm3.cname), ''),
              NULLIF(TRIM(acm.acname), ''),
              'Unknown'
          )
      END as name,
      COUNT(DISTINCT all_crops.farmer_id) as value
  FROM (
      SELECT id as farmer_id, ccode as crop_code FROM myfarmers_data WHERE ccode IS NOT NULL AND TRIM(ccode) != ''
      UNION ALL
      SELECT id as farmer_id, ccode1 as crop_code FROM myfarmers_data WHERE ccode1 IS NOT NULL AND TRIM(ccode1) != ''
      UNION ALL
      SELECT id as farmer_id, ccode2 as crop_code FROM myfarmers_data WHERE ccode2 IS NOT NULL AND TRIM(ccode2) != ''
      UNION ALL
      SELECT id as farmer_id, ccode3 as crop_code FROM myfarmers_data WHERE ccode3 IS NOT NULL AND TRIM(ccode3) != ''
      UNION ALL
      SELECT id as farmer_id, accode as crop_code FROM myfarmers_data WHERE accode IS NOT NULL AND TRIM(accode) != ''
  ) all_crops
  LEFT JOIN cropmaster cm ON all_crops.crop_code = cm.ccode
  LEFT JOIN cropmaster1 cm1 ON all_crops.crop_code = cm1.ccode1
  LEFT JOIN cropmaster2 cm2 ON all_crops.crop_code = cm2.ccode2
  LEFT JOIN cropmaster3 cm3 ON all_crops.crop_code = cm3.ccode3
  LEFT JOIN addcropmaster acm ON all_crops.crop_code = acm.accode
  WHERE (cm.ccode IS NOT NULL 
      OR cm1.ccode1 IS NOT NULL 
      OR cm2.ccode2 IS NOT NULL 
      OR cm3.ccode3 IS NOT NULL 
      OR acm.accode IS NOT NULL)
  GROUP BY CASE all_crops.crop_code
      WHEN 'C001' THEN 'Paddy'
      WHEN 'C002' THEN 'Sorghum'
      WHEN 'C004' THEN 'Ragi'
      WHEN 'C005' THEN 'Maize'
      WHEN 'C013' THEN 'Groundnut'
      WHEN 'C003' THEN 'Cotton'
      ELSE COALESCE(
          NULLIF(TRIM(cm.cname), ''),
          NULLIF(TRIM(cm1.cname), ''),
          NULLIF(TRIM(cm2.cname), ''),
          NULLIF(TRIM(cm3.cname), ''),
          NULLIF(TRIM(acm.acname), ''),
          'Unknown'
      )
  END
  ORDER BY value DESC
  LIMIT 10
`)
    ]);
    
    console.timeEnd('chart-data-complete-query');
    
    // Process and structure the data
    const chartData = {
      genderData: genderResult[0] || [],
      ageData: ageResult[0] || [],
      mgnregaData: mgnregaResult[0] || [],
      fpoMembershipData: fpoResult[0] || [],
      stockInsuranceData: stockInsuranceResult[0] || [],
      irrigationFarmersData: irrigationResult[0] || [],
      livestockSummary: livestockResult[0] || [],
      soilTypeData: soilTypeResult[0] || [],
      lastYearYieldsAnalysisData: yieldResult[0] || [],
      cropUsageData: cropResult[0] || []
    };
    
    res.json(chartData);
    
  } catch (error) {
    console.error('Complete chart data error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message 
    });
  }
});

app.listen(port,'0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});


//docker
// const port = process.env.PORT || 5002;
// // Start server
// app.listen(port,'0.0.0.0', () => {
//   console.log(`Server running on port ${\port}`);
// });








