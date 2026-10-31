// enrollmentRoutes.js - COMPLETE WORKING VERSION
const express = require('express');
const NodeCache = require('node-cache');

const routeCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

module.exports = (pool, poolPromise, cache) => {
  const router = express.Router();

  // ============================================
  // BUILD WHERE CLAUSE
  // ============================================
  function buildWhere(query) {
    const where = [];
    const params = [];

    // Handle filterKey/filterValue pairs
    if (query.filterKey && query.filterValue) {
      const keys = Array.isArray(query.filterKey) ? query.filterKey : [query.filterKey];
      const values = Array.isArray(query.filterValue) ? query.filterValue : [query.filterValue];
      
      keys.forEach((key, index) => {
        const value = values[index] || values[0];
        if (value && value.trim()) {
          switch(key) {
            case 'state':
              where.push(`state_scode = ?`);
              params.push(value);
              break;
            case 'district':
              where.push(`district_dcode = ?`);
              params.push(value);
              break;
            case 'location':
              where.push(`location_lcode = ?`);
              params.push(value);
              break;
            case 'cluster':
              where.push(`cluster_ccode = ?`);
              params.push(value);
              break;
            case 'group':
              where.push(`group_gcode = ?`);
              params.push(value);
              break;
          }
        }
      });
    }

    // Search
    if (query.search && String(query.search).trim()) {
      const s = `%${String(query.search).trim()}%`;
      where.push(`(member_mcode LIKE ? OR nonmembername LIKE ? OR farmerName LIKE ? OR farmerMobile LIKE ?)`);
      params.push(s, s, s, s);
    }

    return {
      whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
      params
    };
  }

  // ============================================
  // TEST ENDPOINT
  // ============================================
  router.get('/test-direct', async (req, res) => {
    try {
      const [countResult] = await poolPromise.query('SELECT COUNT(*) as total FROM myfarmers_data');
      const total = countResult[0]?.total || 0;
      const [rawData] = await poolPromise.query('SELECT * FROM myfarmers_data LIMIT 3');
      
      res.json({
        success: true,
        totalRecords: total,
        sampleData: rawData,
        message: total > 0 ? 'Data exists' : 'No data found'
      });
    } catch (error) {
      console.error('Test error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // FAST MEMBERS - WORKING VERSION
  // ============================================
  router.get('/members/fast', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const { whereClause, params } = buildWhere(req.query);

      console.log('📊 Query:', { page, limit, whereClause, params });

      // Get count
      const countQuery = `SELECT COUNT(*) as total FROM myfarmers_data ${whereClause}`;
      const [countResult] = await poolPromise.query(countQuery, params);
      const total = countResult[0]?.total || 0;

      // Get data
      const dataQuery = `
        SELECT 
          id,
          state_scode,
          district_dcode,
          location_lcode,
          cluster_ccode,
          group_gcode,
          member_mcode,
          farmerName,
          nonmembername,
          isMemberinFPO,
          nameoftheFPO,
          gender,
          age,
          mgnrega,
          farmerMobile,
          aadharNumber,
          doorNo,
          street,
          spouseName,
          fatherName,
          datebirth,
          alternateNumber,
          stock_insurance_enrollment,
          latitude,
          longitude,
          irrigationType,
          irrigationtyperainfed,
          irrigationtypeborewell,
          irrigationtypedrip,
          totalAcresinTankfed,
          areaofCultivationinTankfed,
          soilType1,
          ccode1,
          v_id1,
          sv_id1,
          lastyearyields1,
          category1,
          totalAcresinRainfed,
          areaofCultivationinRainfed,
          soilType2,
          ccode2,
          v_id2,
          sv_id2,
          lastyearyields2,
          category2,
          totalAcresinBorewell,
          areaofCultivationinBorewell,
          soilType3,
          ccode3,
          v_id3,
          sv_id3,
          lastyearyields3,
          category3,
          totalAcresinDripOpenWellCanalIrrigation,
          areaofCultivationinDripOpenWellCanalIrrigation,
          soilType,
          ccode,
          v_id,
          sv_id,
          lastyearyields,
          category4,
          NoofLivestockCow,
          VarietyBreadCow,
          FeedingTypeCow,
          WhetherFodderCultivatedCow,
          MilkYieldDayAnimalCow,
          AverageIncomeCow,
          NoofLivestockBuffalow,
          FeedingTypeBuffalow,
          MilkYieldDayAnimalBuffalow,
          AverageIncomeBuffalow,
          NoofLivestockGoat,
          VarietyBreadGoat,
          FeedingTypeGoat,
          MilkYieldDayAnimalGoat,
          AverageIncomeGoat,
          NoofLivestockSheep,
          FeedingTypeSheep,
          MilkYieldDayAnimalSheep,
          AverageIncomeSheep
        FROM myfarmers_data
        ${whereClause}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await poolPromise.query(dataQuery, [...params, limit, offset]);

      // Get location names
      let stateMap = {}, districtMap = {}, locationMap = {}, clusterMap = {}, groupMap = {};

      if (rows.length > 0) {
        // States
        const stateCodes = [...new Set(rows.map(r => r.state_scode).filter(Boolean))];
        if (stateCodes.length > 0) {
          const [states] = await poolPromise.query(
            'SELECT state_scode, state_sname FROM state WHERE state_scode IN (?)',
            [stateCodes]
          );
          stateMap = Object.fromEntries(states.map(s => [s.state_scode, s.state_sname]));
        }

        // Districts
        const districtCodes = [...new Set(rows.map(r => r.district_dcode).filter(Boolean))];
        if (districtCodes.length > 0) {
          const [districts] = await poolPromise.query(
            'SELECT district_dcode, district_dname FROM district WHERE district_dcode IN (?)',
            [districtCodes]
          );
          districtMap = Object.fromEntries(districts.map(d => [d.district_dcode, d.district_dname]));
        }

        // Locations
        const locationCodes = [...new Set(rows.map(r => r.location_lcode).filter(Boolean))];
        if (locationCodes.length > 0) {
          const [locations] = await poolPromise.query(
            'SELECT location_lcode, location_lname FROM location WHERE location_lcode IN (?)',
            [locationCodes]
          );
          locationMap = Object.fromEntries(locations.map(l => [l.location_lcode, l.location_lname]));
        }

        // Clusters
        const clusterCodes = [...new Set(rows.map(r => r.cluster_ccode).filter(Boolean))];
        if (clusterCodes.length > 0) {
          const [clusters] = await poolPromise.query(
            'SELECT cluster_ccode, cluster_cname FROM cluster WHERE cluster_ccode IN (?)',
            [clusterCodes]
          );
          clusterMap = Object.fromEntries(clusters.map(c => [c.cluster_ccode, c.cluster_cname]));
        }

        // Groups
        const groupCodes = [...new Set(rows.map(r => r.group_gcode).filter(Boolean))];
        if (groupCodes.length > 0) {
          const [groups] = await poolPromise.query(
            'SELECT group_gcode, group_cname FROM grp WHERE group_gcode IN (?)',
            [groupCodes]
          );
          groupMap = Object.fromEntries(groups.map(g => [g.group_gcode, g.group_cname]));
        }
      }

      // Add names to rows
      const dataWithNames = rows.map(row => ({
        ...row,
        state_sname: stateMap[row.state_scode] || '',
        district_name: districtMap[row.district_dcode] || '',
        location_name: locationMap[row.location_lcode] || '',
        cluster_name: clusterMap[row.cluster_ccode] || '',
        group_name: groupMap[row.group_gcode] || ''
      }));

      console.log(`✅ Found ${total} records, returning ${dataWithNames.length}`);

      res.json({
        success: true,
        data: dataWithNames,
        pagination: {
          totalRecords: total || 0,
          currentPage: page,
          totalPages: Math.max(1, Math.ceil((total || 0) / limit)),
          limit: limit
        }
      });
    } catch (error) {
      console.error('❌ Fast members error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch records',
        details: error.message,
        data: [],
        pagination: { totalRecords: 0, currentPage: 1, totalPages: 0, limit: 20 }
      });
    }
  });

  // ============================================
  // CROP NAMES
  // ============================================
  router.get('/crop-names', async (req, res) => {
    try {
      const cacheKey = 'crop_names_all';
      let cached = routeCache.get(cacheKey);
      if (cached) return res.json(cached);

      const [crop1, crop2, crop3, crop, addCrop] = await Promise.all([
        poolPromise.query('SELECT ccode1, cname FROM cropmaster1'),
        poolPromise.query('SELECT ccode2, cname FROM cropmaster2'),
        poolPromise.query('SELECT ccode3, cname FROM cropmaster3'),
        poolPromise.query('SELECT ccode, cname FROM cropmaster'),
        poolPromise.query('SELECT accode, acname FROM addcropmaster'),
      ]);

      const result = {
        crop1: Object.fromEntries(crop1[0].map(c => [c.ccode1, c.cname])),
        crop2: Object.fromEntries(crop2[0].map(c => [c.ccode2, c.cname])),
        crop3: Object.fromEntries(crop3[0].map(c => [c.ccode3, c.cname])),
        crop: Object.fromEntries(crop[0].map(c => [c.ccode, c.cname])),
        addCrop: Object.fromEntries(addCrop[0].map(c => [c.accode, c.acname])),
      };

      routeCache.set(cacheKey, result, 3600);
      res.json(result);
    } catch (error) {
      console.error('❌ Crop names error:', error);
      res.status(500).json({ error: 'Failed to fetch crop names' });
    }
  });

  // ============================================
  // HIERARCHY ENDPOINTS
  // ============================================
  router.get('/hierarchy/states', async (req, res) => {
    try {
      const [rows] = await poolPromise.query(
        'SELECT state_scode as code, state_sname as name FROM state ORDER BY state_sname'
      );
      res.json(rows);
    } catch (error) {
      console.error('Error loading states:', error);
      res.status(500).json({ error: 'Failed to load states' });
    }
  });

  router.get('/hierarchy/districts/:stateCode', async (req, res) => {
    try {
      const { stateCode } = req.params;
      const [rows] = await poolPromise.query(
        'SELECT district_dcode as code, district_dname as name FROM district WHERE state_scode = ? ORDER BY district_dname',
        [stateCode]
      );
      res.json(rows);
    } catch (error) {
      console.error('Error loading districts:', error);
      res.status(500).json({ error: 'Failed to load districts' });
    }
  });

  router.get('/hierarchy/locations/:districtCode', async (req, res) => {
    try {
      const { districtCode } = req.params;
      const [rows] = await poolPromise.query(
        'SELECT location_lcode as code, location_lname as name FROM location WHERE district_dcode = ? ORDER BY location_lname',
        [districtCode]
      );
      res.json(rows);
    } catch (error) {
      console.error('Error loading locations:', error);
      res.status(500).json({ error: 'Failed to load locations' });
    }
  });

  router.get('/hierarchy/clusters/:locationCode', async (req, res) => {
    try {
      const { locationCode } = req.params;
      const [rows] = await poolPromise.query(
        'SELECT cluster_ccode as code, cluster_cname as name FROM cluster WHERE location_lcode = ? ORDER BY cluster_cname',
        [locationCode]
      );
      res.json(rows);
    } catch (error) {
      console.error('Error loading clusters:', error);
      res.status(500).json({ error: 'Failed to load clusters' });
    }
  });

  router.get('/hierarchy/groups/:clusterCode', async (req, res) => {
    try {
      const { clusterCode } = req.params;
      const [rows] = await poolPromise.query(
        'SELECT group_gcode as code, group_cname as name FROM grp WHERE cluster_ccode = ? ORDER BY group_cname',
        [clusterCode]
      );
      res.json(rows);
    } catch (error) {
      console.error('Error loading groups:', error);
      res.status(500).json({ error: 'Failed to load groups' });
    }
  });

  // ============================================
  // CSV EXPORT
  // ============================================
/*router.get('/members/export', async (req, res) => {
  try {
    const { whereClause, params } = buildWhere(req.query);

    // Step 1: Get raw data from myfarmers_data
    const dataQuery = `
      SELECT * FROM myfarmers_data
      ${whereClause}
      ORDER BY id ASC
    `;

    const [rows] = await poolPromise.query(dataQuery, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data found to export' });
    }

    // Step 2: Get all lookup data in parallel
    const [
      states, districts, locations, clusters, groups,
      crop1, crop2, crop3, crop, addCrop,
      variety1, variety2, variety3, variety, addVariety,
      subVariety1, subVariety2, subVariety3, subVariety, addSubVariety
    ] = await Promise.all([
      poolPromise.query('SELECT state_scode, state_sname FROM state'),
      poolPromise.query('SELECT district_dcode, district_dname FROM district'),
      poolPromise.query('SELECT location_lcode, location_lname FROM location'),
      poolPromise.query('SELECT cluster_ccode, cluster_cname FROM cluster'),
      poolPromise.query('SELECT group_gcode, group_cname FROM grp'),
      poolPromise.query('SELECT ccode1, cname FROM cropmaster1'),
      poolPromise.query('SELECT ccode2, cname FROM cropmaster2'),
      poolPromise.query('SELECT ccode3, cname FROM cropmaster3'),
      poolPromise.query('SELECT ccode, cname FROM cropmaster'),
      poolPromise.query('SELECT accode, acname FROM addcropmaster'),
      poolPromise.query('SELECT v_id1, cvariety FROM cropvariety1'),
      poolPromise.query('SELECT v_id2, cvariety FROM cropvariety2'),
      poolPromise.query('SELECT v_id3, cvariety FROM cropvariety3'),
      poolPromise.query('SELECT v_id, cvariety FROM cropvariety'),
      poolPromise.query('SELECT av_id, acvariety FROM addcropvariety'),
      poolPromise.query('SELECT sv_id1, subvariety FROM cropsubvariety1'),
      poolPromise.query('SELECT sv_id2, subvariety FROM cropsubvariety2'),
      poolPromise.query('SELECT sv_id3, subvariety FROM cropsubvariety3'),
      poolPromise.query('SELECT sv_id, subvariety FROM cropsubvariety'),
      poolPromise.query('SELECT asv_id, asubvariety FROM addcropsubvariety'),
    ]);

    // Step 3: Create lookup maps
    const stateMap = Object.fromEntries(states[0].map(s => [s.state_scode, s.state_sname]));
    const districtMap = Object.fromEntries(districts[0].map(d => [d.district_dcode, d.district_dname]));
    const locationMap = Object.fromEntries(locations[0].map(l => [l.location_lcode, l.location_lname]));
    const clusterMap = Object.fromEntries(clusters[0].map(c => [c.cluster_ccode, c.cluster_cname]));
    const groupMap = Object.fromEntries(groups[0].map(g => [g.group_gcode, g.group_cname]));

    const cropMap1 = Object.fromEntries(crop1[0].map(c => [c.ccode1, c.cname]));
    const cropMap2 = Object.fromEntries(crop2[0].map(c => [c.ccode2, c.cname]));
    const cropMap3 = Object.fromEntries(crop3[0].map(c => [c.ccode3, c.cname]));
    const cropMap = Object.fromEntries(crop[0].map(c => [c.ccode, c.cname]));
    const addCropMap = Object.fromEntries(addCrop[0].map(c => [c.accode, c.acname]));

    const varietyMap1 = Object.fromEntries(variety1[0].map(v => [v.v_id1, v.cvariety]));
    const varietyMap2 = Object.fromEntries(variety2[0].map(v => [v.v_id2, v.cvariety]));
    const varietyMap3 = Object.fromEntries(variety3[0].map(v => [v.v_id3, v.cvariety]));
    const varietyMap = Object.fromEntries(variety[0].map(v => [v.v_id, v.cvariety]));
    const addVarietyMap = Object.fromEntries(addVariety[0].map(v => [v.av_id, v.acvariety]));

    const subVarietyMap1 = Object.fromEntries(subVariety1[0].map(sv => [sv.sv_id1, sv.subvariety]));
    const subVarietyMap2 = Object.fromEntries(subVariety2[0].map(sv => [sv.sv_id2, sv.subvariety]));
    const subVarietyMap3 = Object.fromEntries(subVariety3[0].map(sv => [sv.sv_id3, sv.subvariety]));
    const subVarietyMap = Object.fromEntries(subVariety[0].map(sv => [sv.sv_id, sv.subvariety]));
    const addSubVarietyMap = Object.fromEntries(addSubVariety[0].map(sv => [sv.asv_id, sv.asubvariety]));

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enrollment_${new Date().toISOString().split('T')[0]}.csv"`);

    // ============================================
    // COMPLETE HEADERS - ALL COLUMNS
    // ============================================
    const headers = [
      'S.No', 'ID', 'State', 'District', 'Location', 'Cluster', 'Group',
      'Member Code', 'Member Name', 'Non Member Name', 'FPO Member', 'FPO Name',
      'Gender', 'Age', 'MGNREGA', 'Mobile', 'Aadhar', 'Door No', 'Street',
      'Spouse', 'Father', 'DOB', 'Alternate No', 'Insurance', 'Latitude', 'Longitude',
      'Irrigation Type', 'Rainfed Type', 'Borewell Type', 'Drip Type',
      'Total Tankfed', 'Area Tankfed', 'Soil Type 1',
      'Crop 1', 'Variety 1', 'Sub Variety 1', 'Yield 1', 'Category 1',
      'Total Rainfed', 'Area Rainfed', 'Soil Type 2',
      'Crop 2', 'Variety 2', 'Sub Variety 2', 'Yield 2', 'Category 2',
      'Total Borewell', 'Area Borewell', 'Soil Type 3',
      'Crop 3', 'Variety 3', 'Sub Variety 3', 'Yield 3', 'Category 3',
      'Total Drip', 'Area Drip', 'Soil Type',
      'Crop', 'Variety', 'Sub Variety', 'Yield', 'Category',
      'No. Cows', 'Cow Breed', 'Cow Feeding', 'Cow Fodder',
      'Cow Milk/Day', 'Cow Income',
      'No. Buffaloes', 'Buffalo Feeding', 'Buffalo Milk/Day', 'Buffalo Income',
      'No. Goats', 'Goat Breed', 'Goat Feeding', 'Goat Milk/Day', 'Goat Income',
      'No. Sheep', 'Sheep Feeding', 'Sheep Milk/Day', 'Sheep Income',
      'Start Month', 'End Month', 'Survey No',
      'Land Ownership 1', 'Cultivation Practice 1', 'Land Position 1', 'Land Type 1',
      'Land Ownership 2', 'Cultivation Practice 2', 'Land Position 2', 'Land Type 2',
      'Land Ownership 3', 'Cultivation Practice 3', 'Land Position 3', 'Land Type 3',
      'Land Ownership', 'Cultivation Practice', 'Land Position', 'Land Type',
      'Season 1', 'Fertilizer 1', 'Bio Fertilizer 1', 'Rate of Sales 1', 'Machinery 1', 'Crop Insurance 1',
      'Season 2', 'Fertilizer 2', 'Bio Fertilizer 2', 'Rate of Sales 2', 'Machinery 2', 'Crop Insurance 2',
      'Season 3', 'Fertilizer 3', 'Bio Fertilizer 3', 'Rate of Sales 3', 'Machinery 3', 'Crop Insurance 3',
      'Season', 'Fertilizer', 'Bio Fertilizer', 'Rate of Sales', 'Machinery', 'Crop Insurance',
      'Add Crop', 'Add Variety', 'Add Sub Variety',
      'Add Season 1', 'Add Fertilizer 1', 'Add Bio Fertilizer 1', 'Add Yield 1', 'Add Rate of Sales 1', 'Add Machinery 1', 'Add Crop Insurance 1',
      'Live Stock Details', 'Livestock Buffalo', 'Livestock Goat', 'Livestock Sheep',
      'Cow Milking', 'Cow Sales Frequency', 'Cow Vet Hospital', 'Cow Disease', 'Cow Treatment',
      'Buffalo Milking', 'Buffalo Sales Frequency', 'Buffalo Vet Hospital', 'Buffalo Disease', 'Buffalo Treatment',
      'Goat Milking', 'Goat Sales Frequency', 'Goat Vet Hospital', 'Goat Disease', 'Goat Treatment',
      'Sheep Milking', 'Sheep Sales Frequency', 'Sheep Vet Hospital', 'Sheep Disease', 'Sheep Treatment',
      'Insurance Details', 'Insurance Cow 23', 'Insurance Cow 24',
      'Insurance Buffalo 23', 'Insurance Buffalo 24',
      'Insurance Goat 23', 'Insurance Goat 24',
      'Insurance Sheep 23', 'Insurance Sheep 24',
      'Insurance Others 23', 'Insurance Others 24'
    ];

    // Write BOM for Excel and headers
    res.write('\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n');

    const csvEscape = (v) => {
      if (v === null || v === undefined) return '""';
      const str = String(v).replace(/"/g, '""');
      return `"${str}"`;
    };

    // Step 4: Process each row and map all values
    let rowIndex = 0;
    for (const row of rows) {
      rowIndex++;
      
      // Map all values
      const mappedRow = {
        sno: rowIndex,
        id: row.id,
        state_sname: stateMap[row.state_scode] || '',
        district_name: districtMap[row.district_dcode] || '',
        location_name: locationMap[row.location_lcode] || '',
        cluster_name: clusterMap[row.cluster_ccode] || '',
        group_name: groupMap[row.group_gcode] || '',
        member_mcode: row.member_mcode || '',
        farmerName: row.farmerName || '',
        nonmembername: row.nonmembername || '',
        isMemberinFPO: row.isMemberinFPO || '',
        nameoftheFPO: row.nameoftheFPO || '',
        gender: row.gender || '',
        age: row.age || '',
        mgnrega: row.mgnrega || '',
        farmerMobile: row.farmerMobile || '',
        aadharNumber: row.aadharNumber || '',
        doorNo: row.doorNo || '',
        street: row.street || '',
        spouseName: row.spouseName || '',
        fatherName: row.fatherName || '',
        datebirth: row.datebirth || '',
        alternateNumber: row.alternateNumber || '',
        stock_insurance_enrollment: row.stock_insurance_enrollment || '',
        latitude: row.latitude || '',
        longitude: row.longitude || '',
        irrigationType: row.irrigationType || '',
        irrigationtyperainfed: row.irrigationtyperainfed || '',
        irrigationtypeborewell: row.irrigationtypeborewell || '',
        irrigationtypedrip: row.irrigationtypedrip || '',
        totalAcresinTankfed: row.totalAcresinTankfed || '',
        areaofCultivationinTankfed: row.areaofCultivationinTankfed || '',
        soilType1: row.soilType1 || '',
        cropname1: cropMap1[row.ccode1] || row.ccode1 || '',
        variety1: varietyMap1[row.v_id1] || row.v_id1 || '',
        subvariety1: subVarietyMap1[row.sv_id1] || row.sv_id1 || '',
        lastyearyields1: row.lastyearyields1 || '',
        category1: row.category1 || '',
        totalAcresinRainfed: row.totalAcresinRainfed || '',
        areaofCultivationinRainfed: row.areaofCultivationinRainfed || '',
        soilType2: row.soilType2 || '',
        cropname2: cropMap2[row.ccode2] || row.ccode2 || '',
        variety2: varietyMap2[row.v_id2] || row.v_id2 || '',
        subvariety2: subVarietyMap2[row.sv_id2] || row.sv_id2 || '',
        lastyearyields2: row.lastyearyields2 || '',
        category2: row.category2 || '',
        totalAcresinBorewell: row.totalAcresinBorewell || '',
        areaofCultivationinBorewell: row.areaofCultivationinBorewell || '',
        soilType3: row.soilType3 || '',
        cropname3: cropMap3[row.ccode3] || row.ccode3 || '',
        variety3: varietyMap3[row.v_id3] || row.v_id3 || '',
        subvariety3: subVarietyMap3[row.sv_id3] || row.sv_id3 || '',
        lastyearyields3: row.lastyearyields3 || '',
        category3: row.category3 || '',
        totalAcresinDripOpenWellCanalIrrigation: row.totalAcresinDripOpenWellCanalIrrigation || '',
        areaofCultivationinDripOpenWellCanalIrrigation: row.areaofCultivationinDripOpenWellCanalIrrigation || '',
        soilType: row.soilType || '',
        cropname: cropMap[row.ccode] || row.ccode || '',
        variety: varietyMap[row.v_id] || row.v_id || '',
        subvariety: subVarietyMap[row.sv_id] || row.sv_id || '',
        lastyearyields: row.lastyearyields || '',
        category4: row.category4 || '',
        NoofLivestockCow: row.NoofLivestockCow || '',
        VarietyBreadCow: row.VarietyBreadCow || '',
        FeedingTypeCow: row.FeedingTypeCow || '',
        WhetherFodderCultivatedCow: row.WhetherFodderCultivatedCow || '',
        MilkYieldDayAnimalCow: row.MilkYieldDayAnimalCow || '',
        AverageIncomeCow: row.AverageIncomeCow || '',
        NoofLivestockBuffalow: row.NoofLivestockBuffalow || '',
        FeedingTypeBuffalow: row.FeedingTypeBuffalow || '',
        MilkYieldDayAnimalBuffalow: row.MilkYieldDayAnimalBuffalow || '',
        AverageIncomeBuffalow: row.AverageIncomeBuffalow || '',
        NoofLivestockGoat: row.NoofLivestockGoat || '',
        VarietyBreadGoat: row.VarietyBreadGoat || '',
        FeedingTypeGoat: row.FeedingTypeGoat || '',
        MilkYieldDayAnimalGoat: row.MilkYieldDayAnimalGoat || '',
        AverageIncomeGoat: row.AverageIncomeGoat || '',
        NoofLivestockSheep: row.NoofLivestockSheep || '',
        FeedingTypeSheep: row.FeedingTypeSheep || '',
        MilkYieldDayAnimalSheep: row.MilkYieldDayAnimalSheep || '',
        AverageIncomeSheep: row.AverageIncomeSheep || '',
        startMonth: row.startMonth || '',
        endMonth: row.endMonth || '',
        surveyno_number: row.surveyno_number || '',
        landownership1: row.landownership1 || '',
        cultivationpractice1: row.cultivationpractice1 || '',
        landposition1: row.landposition1 || '',
        landtype1: row.landtype1 || '',
        landownership2: row.landownership2 || '',
        cultivationpractice2: row.cultivationpractice2 || '',
        landposition2: row.landposition2 || '',
        landtype2: row.landtype2 || '',
        landownership3: row.landownership3 || '',
        cultivationpractice3: row.cultivationpractice3 || '',
        landposition3: row.landposition3 || '',
        landtype3: row.landtype3 || '',
        landownership: row.landownership || '',
        cultivationpractice: row.cultivationpractice || '',
        landposition: row.landposition || '',
        landtype: row.landtype || '',
        season1: row.season1 || '',
        fertilizer1: row.fertilizer1 || '',
        biofertilizer1: row.biofertilizer1 || '',
        rateofsales1: row.rateofsales1 || '',
        availabilityofMachinery1: row.availabilityofMachinery1 || '',
        cropInsurance1: row.cropInsurance1 || '',
        season2: row.season2 || '',
        fertilizer2: row.fertilizer2 || '',
        biofertilizer2: row.biofertilizer2 || '',
        rateofsales2: row.rateofsales2 || '',
        availabilityofMachinery2: row.availabilityofMachinery2 || '',
        cropInsurance2: row.cropInsurance2 || '',
        season3: row.season3 || '',
        fertilizer3: row.fertilizer3 || '',
        biofertilizer3: row.biofertilizer3 || '',
        rateofsales3: row.rateofsales3 || '',
        availabilityofMachinery3: row.availabilityofMachinery3 || '',
        cropInsurance3: row.cropInsurance3 || '',
        season: row.season || '',
        fertilizer: row.fertilizer || '',
        biofertilizer: row.biofertilizer || '',
        rateofsales: row.rateofsales || '',
        availabilityofMachinery: row.availabilityofMachinery || '',
        cropInsurance: row.cropInsurance || '',
        cropname6: addCropMap[row.accode] || row.accode || '',
        variety6: addVarietyMap[row.av_id] || row.av_id || '',
        subvariety6: addSubVarietyMap[row.asv_id] || row.asv_id || '',
        Addseason1: row.Addseason1 || '',
        Addfertilizer1: row.Addfertilizer1 || '',
        Addbiofertilizer1: row.Addbiofertilizer1 || '',
        Addlastyearyields1: row.Addlastyearyields1 || '',
        Addrateofsales1: row.Addrateofsales1 || '',
        AddavailabilityofMachinery1: row.AddavailabilityofMachinery1 || '',
        addcropInsurance1: row.addcropInsurance1 || '',
        liveStockDetails: row.liveStockDetails || '',
        Livestockbuffalow: row.Livestockbuffalow || '',
        Livestockgoat: row.Livestockgoat || '',
        Livestocksheep: row.Livestocksheep || '',
        NoofMilkYieldingAnimalCow: row.NoofMilkYieldingAnimalCow || '',
        FrequencyofSalesCow: row.FrequencyofSalesCow || '',
        NearbyVeterinaryHospitalCow: row.NearbyVeterinaryHospitalCow || '',
        AnyseasonaldiseaseoutbreakCow: row.AnyseasonaldiseaseoutbreakCow || '',
        TreatmentMethodFollowedCow: row.TreatmentMethodFollowedCow || '',
        NoofMilkYieldingAnimalBuffalow: row.NoofMilkYieldingAnimalBuffalow || '',
        FrequencyofSalesBuffalow: row.FrequencyofSalesBuffalow || '',
        NearbyVeterinaryHospitalBuffalow: row.NearbyVeterinaryHospitalBuffalow || '',
        AnyseasonaldiseaseoutbreakBuffalow: row.AnyseasonaldiseaseoutbreakBuffalow || '',
        TreatmentMethodFollowedBuffalow: row.TreatmentMethodFollowedBuffalow || '',
        NoofMilkYieldingAnimalGoat: row.NoofMilkYieldingAnimalGoat || '',
        FrequencyofSalesGoat: row.FrequencyofSalesGoat || '',
        NearbyVeterinaryHospitalGoat: row.NearbyVeterinaryHospitalGoat || '',
        AnyseasonaldiseaseoutbreakGoat: row.AnyseasonaldiseaseoutbreakGoat || '',
        TreatmentMethodFollowedGoat: row.TreatmentMethodFollowedGoat || '',
        NoofMilkYieldingAnimalSheep: row.NoofMilkYieldingAnimalSheep || '',
        FrequencyofSalesSheep: row.FrequencyofSalesSheep || '',
        NearbyVeterinaryHospitalSheep: row.NearbyVeterinaryHospitalSheep || '',
        AnyseasonaldiseaseoutbreakSheep: row.AnyseasonaldiseaseoutbreakSheep || '',
        TreatmentMethodFollowedSheep: row.TreatmentMethodFollowedSheep || '',
        LiveStockInsuranceDetails: row.LiveStockInsuranceDetails || '',
        LiveStockInsuranceDetailsCow23: row.LiveStockInsuranceDetailsCow23 || '',
        LiveStockInsuranceDetailsCow24: row.LiveStockInsuranceDetailsCow24 || '',
        LiveStockInsuranceDetailsbuffalo23: row.LiveStockInsuranceDetailsbuffalo23 || '',
        LiveStockInsuranceDetailsbuffalo24: row.LiveStockInsuranceDetailsbuffalo24 || '',
        LiveStockInsuranceDetailsgoat23: row.LiveStockInsuranceDetailsgoat23 || '',
        LiveStockInsuranceDetailsgoat24: row.LiveStockInsuranceDetailsgoat24 || '',
        LiveStockInsuranceDetailssheep23: row.LiveStockInsuranceDetailssheep23 || '',
        LiveStockInsuranceDetailssheep24: row.LiveStockInsuranceDetailssheep24 || '',
        LiveStockInsuranceDetailsothers23: row.LiveStockInsuranceDetailsothers23 || '',
        LiveStockInsuranceDetailsothers24: row.LiveStockInsuranceDetailsothers24 || '',
      };

      // Convert to CSV line
      const line = Object.values(mappedRow).map(csvEscape).join(',');
      res.write(line + '\n');
    }

    console.log(`✅ CSV export completed: ${rowIndex} rows`);
    res.end();

  } catch (error) {
    console.error('❌ Export error:', error);
    res.status(500).json({ error: 'Export failed', details: error.message });
  }
});
*/

// ============================================
// COMPLETE CSV EXPORT - WITHOUT LATITUDE/LONGITUDE
// ============================================
router.get('/members/export', async (req, res) => {
  try {
    const { whereClause, params } = buildWhere(req.query);

    // Step 1: Get raw data from myfarmers_data
    const dataQuery = `
      SELECT * FROM myfarmers_data
      ${whereClause}
      ORDER BY id ASC
    `;

    const [rows] = await poolPromise.query(dataQuery, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data found to export' });
    }

    // Step 2: Get all lookup data in parallel
    const [
      states, districts, locations, clusters, groups,
      crop1, crop2, crop3, crop, addCrop,
      variety1, variety2, variety3, variety, addVariety,
      subVariety1, subVariety2, subVariety3, subVariety, addSubVariety
    ] = await Promise.all([
      poolPromise.query('SELECT state_scode, state_sname FROM state'),
      poolPromise.query('SELECT district_dcode, district_dname FROM district'),
      poolPromise.query('SELECT location_lcode, location_lname FROM location'),
      poolPromise.query('SELECT cluster_ccode, cluster_cname FROM cluster'),
      poolPromise.query('SELECT group_gcode, group_cname FROM grp'),
      poolPromise.query('SELECT ccode1, cname FROM cropmaster1'),
      poolPromise.query('SELECT ccode2, cname FROM cropmaster2'),
      poolPromise.query('SELECT ccode3, cname FROM cropmaster3'),
      poolPromise.query('SELECT ccode, cname FROM cropmaster'),
      poolPromise.query('SELECT accode, acname FROM addcropmaster'),
      poolPromise.query('SELECT v_id1, cvariety FROM cropvariety1'),
      poolPromise.query('SELECT v_id2, cvariety FROM cropvariety2'),
      poolPromise.query('SELECT v_id3, cvariety FROM cropvariety3'),
      poolPromise.query('SELECT v_id, cvariety FROM cropvariety'),
      poolPromise.query('SELECT av_id, acvariety FROM addcropvariety'),
      poolPromise.query('SELECT sv_id1, subvariety FROM cropsubvariety1'),
      poolPromise.query('SELECT sv_id2, subvariety FROM cropsubvariety2'),
      poolPromise.query('SELECT sv_id3, subvariety FROM cropsubvariety3'),
      poolPromise.query('SELECT sv_id, subvariety FROM cropsubvariety'),
      poolPromise.query('SELECT asv_id, asubvariety FROM addcropsubvariety'),
    ]);

    // Step 3: Create lookup maps
    const stateMap = Object.fromEntries(states[0].map(s => [s.state_scode, s.state_sname]));
    const districtMap = Object.fromEntries(districts[0].map(d => [d.district_dcode, d.district_dname]));
    const locationMap = Object.fromEntries(locations[0].map(l => [l.location_lcode, l.location_lname]));
    const clusterMap = Object.fromEntries(clusters[0].map(c => [c.cluster_ccode, c.cluster_cname]));
    const groupMap = Object.fromEntries(groups[0].map(g => [g.group_gcode, g.group_cname]));

    const cropMap1 = Object.fromEntries(crop1[0].map(c => [c.ccode1, c.cname]));
    const cropMap2 = Object.fromEntries(crop2[0].map(c => [c.ccode2, c.cname]));
    const cropMap3 = Object.fromEntries(crop3[0].map(c => [c.ccode3, c.cname]));
    const cropMap = Object.fromEntries(crop[0].map(c => [c.ccode, c.cname]));
    const addCropMap = Object.fromEntries(addCrop[0].map(c => [c.accode, c.acname]));

    const varietyMap1 = Object.fromEntries(variety1[0].map(v => [v.v_id1, v.cvariety]));
    const varietyMap2 = Object.fromEntries(variety2[0].map(v => [v.v_id2, v.cvariety]));
    const varietyMap3 = Object.fromEntries(variety3[0].map(v => [v.v_id3, v.cvariety]));
    const varietyMap = Object.fromEntries(variety[0].map(v => [v.v_id, v.cvariety]));
    const addVarietyMap = Object.fromEntries(addVariety[0].map(v => [v.av_id, v.acvariety]));

    const subVarietyMap1 = Object.fromEntries(subVariety1[0].map(sv => [sv.sv_id1, sv.subvariety]));
    const subVarietyMap2 = Object.fromEntries(subVariety2[0].map(sv => [sv.sv_id2, sv.subvariety]));
    const subVarietyMap3 = Object.fromEntries(subVariety3[0].map(sv => [sv.sv_id3, sv.subvariety]));
    const subVarietyMap = Object.fromEntries(subVariety[0].map(sv => [sv.sv_id, sv.subvariety]));
    const addSubVarietyMap = Object.fromEntries(addSubVariety[0].map(sv => [sv.asv_id, sv.asubvariety]));

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enrollment_${new Date().toISOString().split('T')[0]}.csv"`);

    // ============================================
    // HEADERS - WITHOUT LATITUDE AND LONGITUDE
    // ============================================
    const headers = [
      // Basic Info (1-7)
      'S.No', 'ID', 'State', 'District', 'Location', 'Cluster', 'Group',
      // Member Info (8-22)
      'Member Code', 'Member Name', 'Non Member Name', 'FPO Member', 'FPO Name',
      'Gender', 'Age', 'MGNREGA', 'Mobile', 'Aadhar', 'Door No', 'Street',
      'Spouse', 'Father', 'DOB', 'Alternate No', 'Insurance',
      // Irrigation (23-26)
      'Irrigation Type', 'Rainfed Type', 'Borewell Type', 'Drip Type',
      // Tankfed (27-28)
      'Total Tankfed', 'Area Tankfed',
      // Crop 1 (29-35)
      'Soil Type 1', 'Crop 1', 'Variety 1', 'Sub Variety 1', 'Yield 1', 'Category 1',
      // Rainfed (36-37)
      'Total Rainfed', 'Area Rainfed',
      // Crop 2 (38-44)
      'Soil Type 2', 'Crop 2', 'Variety 2', 'Sub Variety 2', 'Yield 2', 'Category 2',
      // Borewell (45-46)
      'Total Borewell', 'Area Borewell',
      // Crop 3 (47-53)
      'Soil Type 3', 'Crop 3', 'Variety 3', 'Sub Variety 3', 'Yield 3', 'Category 3',
      // Drip (54-55)
      'Total Drip', 'Area Drip',
      // Generic Crop (56-62)
      'Soil Type', 'Crop', 'Variety', 'Sub Variety', 'Yield', 'Category',
      // Cow (63-68)
      'No. Cows', 'Cow Breed', 'Cow Feeding', 'Cow Fodder', 'Cow Milk/Day', 'Cow Income',
      // Buffalo (69-72)
      'No. Buffaloes', 'Buffalo Feeding', 'Buffalo Milk/Day', 'Buffalo Income',
      // Goat (73-76)
      'No. Goats', 'Goat Breed', 'Goat Feeding', 'Goat Milk/Day', 'Goat Income',
      // Sheep (77-80)
      'No. Sheep', 'Sheep Feeding', 'Sheep Milk/Day', 'Sheep Income',
      // Season/Month (81-82)
      'Start Month', 'End Month',
      // Land Details - Crop 1 (83-86)
      'Land Ownership 1', 'Cultivation Practice 1', 'Land Position 1', 'Land Type 1',
      // Land Details - Crop 2 (87-90)
      'Land Ownership 2', 'Cultivation Practice 2', 'Land Position 2', 'Land Type 2',
      // Land Details - Crop 3 (91-94)
      'Land Ownership 3', 'Cultivation Practice 3', 'Land Position 3', 'Land Type 3',
      // Land Details - Generic (95-98)
      'Land Ownership', 'Cultivation Practice', 'Land Position', 'Land Type',
      // Season/Fertilizer - Crop 1 (99-104)
      'Season 1', 'Fertilizer 1', 'Bio Fertilizer 1', 'Rate of Sales 1', 'Machinery 1', 'Crop Insurance 1',
      // Season/Fertilizer - Crop 2 (105-110)
      'Season 2', 'Fertilizer 2', 'Bio Fertilizer 2', 'Rate of Sales 2', 'Machinery 2', 'Crop Insurance 2',
      // Season/Fertilizer - Crop 3 (111-116)
      'Season 3', 'Fertilizer 3', 'Bio Fertilizer 3', 'Rate of Sales 3', 'Machinery 3', 'Crop Insurance 3',
      // Season/Fertilizer - Generic (117-122)
      'Season', 'Fertilizer', 'Bio Fertilizer', 'Rate of Sales', 'Machinery', 'Crop Insurance',
      // Add Crop (123-125)
      'Add Crop', 'Add Variety', 'Add Sub Variety',
      // Add Crop Details (126-132)
      'Add Season 1', 'Add Fertilizer 1', 'Add Bio Fertilizer 1', 'Add Yield 1', 'Add Rate of Sales 1', 'Add Machinery 1', 'Add Crop Insurance 1',
      // Livestock Details (133-136)
      'Live Stock Details', 'Livestock Buffalo', 'Livestock Goat', 'Livestock Sheep',
      // Cow Details (137-141)
      'Cow Milking', 'Cow Sales Frequency', 'Cow Vet Hospital', 'Cow Disease', 'Cow Treatment',
      // Buffalo Details (142-146)
      'Buffalo Milking', 'Buffalo Sales Frequency', 'Buffalo Vet Hospital', 'Buffalo Disease', 'Buffalo Treatment',
      // Goat Details (147-151)
      'Goat Milking', 'Goat Sales Frequency', 'Goat Vet Hospital', 'Goat Disease', 'Goat Treatment',
      // Sheep Details (152-156)
      'Sheep Milking', 'Sheep Sales Frequency', 'Sheep Vet Hospital', 'Sheep Disease', 'Sheep Treatment',
      // Insurance Details (157-168)
      'Insurance Details', 'Insurance Cow 23', 'Insurance Cow 24',
      'Insurance Buffalo 23', 'Insurance Buffalo 24',
      'Insurance Goat 23', 'Insurance Goat 24',
      'Insurance Sheep 23', 'Insurance Sheep 24',
      'Insurance Others 23', 'Insurance Others 24'
    ];

    // Write BOM for Excel and headers
    res.write('\uFEFF' + headers.map(h => `"${h}"`).join(',') + '\n');

    const csvEscape = (v) => {
      if (v === null || v === undefined) return '""';
      const str = String(v).replace(/"/g, '""');
      return `"${str}"`;
    };

    // Step 4: Process each row - WITHOUT latitude and longitude
    let rowIndex = 0;
    for (const row of rows) {
      rowIndex++;

      const line = [
        // Basic Info
        rowIndex, row.id,
        stateMap[row.state_scode] || '',
        districtMap[row.district_dcode] || '',
        locationMap[row.location_lcode] || '',
        clusterMap[row.cluster_ccode] || '',
        groupMap[row.group_gcode] || '',
        // Member Info (No latitude/longitude)
        row.member_mcode || '',
        row.farmerName || '',
        row.nonmembername || '',
        row.isMemberinFPO || '',
        row.nameoftheFPO || '',
        row.gender || '',
        row.age || '',
        row.mgnrega || '',
        row.farmerMobile || '',
        row.aadharNumber || '',
        row.doorNo || '',
        row.street || '',
        row.spouseName || '',
        row.fatherName || '',
        row.datebirth || '',
        row.alternateNumber || '',
        row.stock_insurance_enrollment || '',
        // Irrigation
        row.irrigationType || '',
        row.irrigationtyperainfed || '',
        row.irrigationtypeborewell || '',
        row.irrigationtypedrip || '',
        // Tankfed
        row.totalAcresinTankfed || '',
        row.areaofCultivationinTankfed || '',
        // Crop 1
        row.soilType1 || '',
        cropMap1[row.ccode1] || row.ccode1 || '',
        varietyMap1[row.v_id1] || row.v_id1 || '',
        subVarietyMap1[row.sv_id1] || row.sv_id1 || '',
        row.lastyearyields1 || '',
        row.category1 || '',
        // Rainfed
        row.totalAcresinRainfed || '',
        row.areaofCultivationinRainfed || '',
        // Crop 2
        row.soilType2 || '',
        cropMap2[row.ccode2] || row.ccode2 || '',
        varietyMap2[row.v_id2] || row.v_id2 || '',
        subVarietyMap2[row.sv_id2] || row.sv_id2 || '',
        row.lastyearyields2 || '',
        row.category2 || '',
        // Borewell
        row.totalAcresinBorewell || '',
        row.areaofCultivationinBorewell || '',
        // Crop 3
        row.soilType3 || '',
        cropMap3[row.ccode3] || row.ccode3 || '',
        varietyMap3[row.v_id3] || row.v_id3 || '',
        subVarietyMap3[row.sv_id3] || row.sv_id3 || '',
        row.lastyearyields3 || '',
        row.category3 || '',
        // Drip
        row.totalAcresinDripOpenWellCanalIrrigation || '',
        row.areaofCultivationinDripOpenWellCanalIrrigation || '',
        // Generic Crop
        row.soilType || '',
        cropMap[row.ccode] || row.ccode || '',
        varietyMap[row.v_id] || row.v_id || '',
        subVarietyMap[row.sv_id] || row.sv_id || '',
        row.lastyearyields || '',
        row.category4 || '',
        // Cow
        row.NoofLivestockCow || '',
        row.VarietyBreadCow || '',
        row.FeedingTypeCow || '',
        row.WhetherFodderCultivatedCow || '',
        row.MilkYieldDayAnimalCow || '',
        row.AverageIncomeCow || '',
        // Buffalo
        row.NoofLivestockBuffalow || '',
        row.FeedingTypeBuffalow || '',
        row.MilkYieldDayAnimalBuffalow || '',
        row.AverageIncomeBuffalow || '',
        // Goat
        row.NoofLivestockGoat || '',
        row.VarietyBreadGoat || '',
        row.FeedingTypeGoat || '',
        row.MilkYieldDayAnimalGoat || '',
        row.AverageIncomeGoat || '',
        // Sheep
        row.NoofLivestockSheep || '',
        row.FeedingTypeSheep || '',
        row.MilkYieldDayAnimalSheep || '',
        row.AverageIncomeSheep || '',
        // Season/Month
        row.startMonth || '',
        row.endMonth || '',
        // Land Details - Crop 1
        row.landownership1 || '',
        row.cultivationpractice1 || '',
        row.landposition1 || '',
        row.landtype1 || '',
        // Land Details - Crop 2
        row.landownership2 || '',
        row.cultivationpractice2 || '',
        row.landposition2 || '',
        row.landtype2 || '',
        // Land Details - Crop 3
        row.landownership3 || '',
        row.cultivationpractice3 || '',
        row.landposition3 || '',
        row.landtype3 || '',
        // Land Details - Generic
        row.landownership || '',
        row.cultivationpractice || '',
        row.landposition || '',
        row.landtype || '',
        // Season/Fertilizer - Crop 1
        row.season1 || '',
        row.fertilizer1 || '',
        row.biofertilizer1 || '',
        row.rateofsales1 || '',
        row.availabilityofMachinery1 || '',
        row.cropInsurance1 || '',
        // Season/Fertilizer - Crop 2
        row.season2 || '',
        row.fertilizer2 || '',
        row.biofertilizer2 || '',
        row.rateofsales2 || '',
        row.availabilityofMachinery2 || '',
        row.cropInsurance2 || '',
        // Season/Fertilizer - Crop 3
        row.season3 || '',
        row.fertilizer3 || '',
        row.biofertilizer3 || '',
        row.rateofsales3 || '',
        row.availabilityofMachinery3 || '',
        row.cropInsurance3 || '',
        // Season/Fertilizer - Generic
        row.season || '',
        row.fertilizer || '',
        row.biofertilizer || '',
        row.rateofsales || '',
        row.availabilityofMachinery || '',
        row.cropInsurance || '',
        // Add Crop
        addCropMap[row.accode] || row.accode || '',
        addVarietyMap[row.av_id] || row.av_id || '',
        addSubVarietyMap[row.asv_id] || row.asv_id || '',
        // Add Crop Details
        row.Addseason1 || '',
        row.Addfertilizer1 || '',
        row.Addbiofertilizer1 || '',
        row.Addlastyearyields1 || '',
        row.Addrateofsales1 || '',
        row.AddavailabilityofMachinery1 || '',
        row.addcropInsurance1 || '',
        // Livestock Details
        row.liveStockDetails || '',
        row.Livestockbuffalow || '',
        row.Livestockgoat || '',
        row.Livestocksheep || '',
        // Cow Details
        row.NoofMilkYieldingAnimalCow || '',
        row.FrequencyofSalesCow || '',
        row.NearbyVeterinaryHospitalCow || '',
        row.AnyseasonaldiseaseoutbreakCow || '',
        row.TreatmentMethodFollowedCow || '',
        // Buffalo Details
        row.NoofMilkYieldingAnimalBuffalow || '',
        row.FrequencyofSalesBuffalow || '',
        row.NearbyVeterinaryHospitalBuffalow || '',
        row.AnyseasonaldiseaseoutbreakBuffalow || '',
        row.TreatmentMethodFollowedBuffalow || '',
        // Goat Details
        row.NoofMilkYieldingAnimalGoat || '',
        row.FrequencyofSalesGoat || '',
        row.NearbyVeterinaryHospitalGoat || '',
        row.AnyseasonaldiseaseoutbreakGoat || '',
        row.TreatmentMethodFollowedGoat || '',
        // Sheep Details
        row.NoofMilkYieldingAnimalSheep || '',
        row.FrequencyofSalesSheep || '',
        row.NearbyVeterinaryHospitalSheep || '',
        row.AnyseasonaldiseaseoutbreakSheep || '',
        row.TreatmentMethodFollowedSheep || '',
        // Insurance Details
        row.LiveStockInsuranceDetails || '',
        row.LiveStockInsuranceDetailsCow23 || '',
        row.LiveStockInsuranceDetailsCow24 || '',
        row.LiveStockInsuranceDetailsbuffalo23 || '',
        row.LiveStockInsuranceDetailsbuffalo24 || '',
        row.LiveStockInsuranceDetailsgoat23 || '',
        row.LiveStockInsuranceDetailsgoat24 || '',
        row.LiveStockInsuranceDetailssheep23 || '',
        row.LiveStockInsuranceDetailssheep24 || '',
        row.LiveStockInsuranceDetailsothers23 || '',
        row.LiveStockInsuranceDetailsothers24 || '',
      ].map(csvEscape).join(',');

      res.write(line + '\n');
    }

    console.log(`✅ CSV export completed: ${rowIndex} rows`);
    res.end();

  } catch (error) {
    console.error('❌ Export error:', error);
    res.status(500).json({ error: 'Export failed', details: error.message });
  }
});



  // HEALTH CHECK
  // ============================================
  router.get('/health', (req, res) => {
    res.json({ 
      ok: true, 
      mounted: true, 
      time: new Date().toISOString(),
      message: 'Enrollment API is working'
    });
  });

  return router;
};
