const express = require('express');
const mysql = require('mysql2');

const app = express();
const port = 3070;
const cors = require('cors');


// Enable CORS for all requests
app.use(cors());
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root', // Replace with your MySQL username
  database: 'dhan', // Replace with your database name
  password:'Harihara11!+',
});

// Test database connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('Connected to database');
  connection.release(); // Release the connection
});

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
  console.log('State Code:', state_scode);
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
  console.log('district_dcode', district_dcode);
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
  console.log('location_lcode', location_lcode);
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
  console.log('cluster_ccode', cluster_ccode);
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
  console.log('group_gcode', group_gcode);
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
