// membersRoutes.js - Fast paginated members list (id 1..N order) + delete
const express = require('express');

module.exports = (pool, poolPromise, cache) => {
  const router = express.Router();

  const JOIN_SQL = `
    FROM myfarmers_data m
    LEFT JOIN state s ON m.state_scode = s.state_scode
    LEFT JOIN district d ON m.district_dcode = d.district_dcode
    LEFT JOIN location l ON m.location_lcode = l.location_lcode
    LEFT JOIN cluster c ON m.cluster_ccode = c.cluster_ccode
    LEFT JOIN grp g ON m.group_gcode = g.group_gcode
  `;

  // Frontend sends CODES (state_scode etc), not names - filter on the raw column
  const FILTER_COL_MAP = {
    state: 'm.state_scode',
    district: 'm.district_dcode',
    location: 'm.location_lcode',
    cluster: 'm.cluster_ccode',
    group: 'm.group_gcode',
  };

  function buildFastWhere(query) {
    const where = [];
    const params = [];

    // Express (qs) turns repeated ?filterKey=a&filterKey=b into arrays automatically
    let filterKeys = query.filterKey;
    let filterValues = query.filterValue;
    if (filterKeys && !Array.isArray(filterKeys)) filterKeys = [filterKeys];
    if (filterValues && !Array.isArray(filterValues)) filterValues = [filterValues];

    if (filterKeys && filterValues) {
      filterKeys.forEach((key, idx) => {
        const val = filterValues[idx];
        if (!val || key === 'all') return;
        const col = FILTER_COL_MAP[key];
        if (col) {
          where.push(`${col} = ?`);
          params.push(val);
        }
      });
    }

    if (query.search && String(query.search).trim()) {
      const s = `%${String(query.search).trim()}%`;
      where.push(`(
        m.member_mcode LIKE ? OR
        m.nonmembername LIKE ? OR
        m.farmerName LIKE ? OR
        m.farmerMobile LIKE ? OR
        m.aadharNumber LIKE ? OR
        m.nameoftheFPO LIKE ? OR
        s.state_sname LIKE ? OR
        d.district_dname LIKE ? OR
        l.location_lname LIKE ? OR
        c.cluster_cname LIKE ? OR
        g.group_cname LIKE ?
      )`);
      params.push(s, s, s, s, s, s, s, s, s, s, s);
    }

    return {
      whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
      params
    };
  }

  // FAST paginated list — strictly ordered by id ASC, 20 at a time by default
  router.get('/fast', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const { whereClause, params } = buildFastWhere(req.query);
      const hasFilters = whereClause.length > 0;

      // Count and data run in PARALLEL, not sequential — this alone cuts latency ~2x
      const countPromise = (async () => {
        if (!hasFilters) {
          const cached = cache.get('fastcount_all');
          if (cached !== undefined) return cached;
          const [r] = await poolPromise.query('SELECT COUNT(*) as total FROM myfarmers_data');
          const total = r[0]?.total || 0;
          cache.set('fastcount_all', total, 300);
          return total;
        }
        const cacheKey = `fastcount_${whereClause}_${JSON.stringify(params)}`;
        const cached = cache.get(cacheKey);
        if (cached !== undefined) return cached;
        const [r] = await poolPromise.query(`SELECT COUNT(*) as total ${JOIN_SQL} ${whereClause}`, params);
        const total = r[0]?.total || 0;
        cache.set(cacheKey, total, 120);
        return total;
      })();

      const dataQuery = `
        SELECT
          m.id,
          COALESCE(s.state_sname, '') as state_sname,
          COALESCE(d.district_dname, '') as district_name,
          COALESCE(l.location_lname, '') as location_name,
          COALESCE(c.cluster_cname, '') as cluster_name,
          COALESCE(g.group_cname, '') as group_name,
          COALESCE(m.member_mcode, '') as member_mcode,
          COALESCE(m.farmerName, '') as farmerName,
          COALESCE(m.nonmembername, '') as nonmembername,
          COALESCE(m.isMemberinFPO, '') as isMemberinFPO,
          COALESCE(m.nameoftheFPO, '') as nameoftheFPO,
          COALESCE(m.gender, '') as gender,
          COALESCE(m.age, '') as age,
          COALESCE(m.mgnrega, '') as mgnrega,
          COALESCE(m.farmerMobile, '') as farmerMobile,
          COALESCE(m.aadharNumber, '') as aadharNumber,
          COALESCE(m.doorNo, '') as doorNo,
          COALESCE(m.street, '') as street,
          COALESCE(m.spouseName, '') as spouseName,
          COALESCE(m.fatherName, '') as fatherName,
          COALESCE(m.datebirth, '') as datebirth,
          COALESCE(m.alternateNumber, '') as alternateNumber,
          COALESCE(m.stock_insurance_enrollment, '') as stock_insurance_enrollment,
          COALESCE(m.latitude, '') as latitude,
          COALESCE(m.longitude, '') as longitude
        ${JOIN_SQL}
        ${whereClause}
        ORDER BY m.id ASC
        LIMIT ? OFFSET ?
      `;
      const dataPromise = poolPromise.query(dataQuery, [...params, limit, offset]);

      const [total, [rows]] = await Promise.all([countPromise, dataPromise]);

      res.json({
        success: true,
        data: rows.map((row, i) => ({ ...row, sno: offset + i + 1 })),
        pagination: {
          currentPage: page,
          limit,
          totalRecords: total,
          totalPages: Math.max(1, Math.ceil(total / limit))
        }
      });
    } catch (error) {
      console.error('members/fast error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch members', details: error.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await poolPromise.query('DELETE FROM myfarmers_data WHERE id = ?', [id]);
      cache.del('fastcount_all');
      res.json({ success: true });
    } catch (error) {
      console.error('Delete member error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete', details: error.message });
    }
  });

  return router;
};
