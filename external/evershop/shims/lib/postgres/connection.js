// Payment Truth shim: a real pg Pool against the throwaway database.
import pg from 'pg';
export const pool = new pg.Pool({ host: '/tmp', port: 54329, user: 'postgres', database: 'evershop_pt', max: 20 });
export const getConnection = () => pool.connect();
