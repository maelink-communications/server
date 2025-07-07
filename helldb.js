import fs from 'node:fs';
import process from "node:process";
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const locks = new Map(); // { dbPath: { type: 'soft'|'full', count: number } }

function createDB(db, initialStructure = {}) {
    fs.writeFileSync(db, JSON.stringify(initialStructure, null, 2));
}

function getDB(db) {
    if (!fs.existsSync(db)) {
        createDB(db);
    }
    try {
        const data = fs.readFileSync(db, 'utf8');
        const parsedData = JSON.parse(data);
        return parsedData;
    } catch (err) {
        console.error(err);
    }
}

function acquireLock(dbPath, type = 'soft') {
    if (locks.has(dbPath)) {
        const lock = locks.get(dbPath);
        if (lock.type === 'full' && type === 'full') {
            throw new Error(`Database ${dbPath} is locked`);
        }
        lock.count++;
    } else {
        locks.set(dbPath, { type, count: 1 });
    }
}

function releaseLock(dbPath) {
    if (locks.has(dbPath)) {
        const lock = locks.get(dbPath);
        lock.count--;
        if (lock.count <= 0) {
            locks.delete(dbPath);
        }
    }
}

function writeDB(db, write, useWorker = false) {
    if (!fs.existsSync(db)) {
        createDB(db);
    }
    acquireLock(db, 'full');
    try {
        if (useWorker && isMainThread) {
            return new Promise((resolve, reject) => {
                const worker = new Worker(__filename, {
                    workerData: { action: 'writeDB', db, write }
                });
                worker.on('message', (result) => {
                    releaseLock(db);
                    resolve(result);
                });
                worker.on('error', (err) => {
                    releaseLock(db);
                    reject(err);
                });
                worker.on('exit', (code) => {
                    releaseLock(db);
                    if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                });
            });
        } else {
            fs.writeFileSync(db, write, function (err) {
                if (err) {
                    console.log(err);
                }
            });
            releaseLock(db);
        }
    } catch (error) {
        releaseLock(db);
        throw error;
    }
}

function addValue(dbval, table, values, useWorker = false) {
    acquireLock(dbval, 'soft');
    try {
        if (useWorker && isMainThread) {
            return new Promise((resolve, reject) => {
                const worker = new Worker(__filename, {
                    workerData: { action: 'addValue', dbval, table, values }
                });
                worker.on('message', (result) => {
                    releaseLock(dbval);
                    if (result.error) reject(new Error(result.error));
                    else resolve(result);
                });
                worker.on('error', (err) => {
                    releaseLock(dbval);
                    reject(err);
                });
                worker.on('exit', (code) => {
                    releaseLock(dbval);
                    if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                });
            });
        } else {
            const db = getDB(dbval);
            if (!db[table]) db[table] = {};
            const constraints = db._constraints?.[table] || {};
            for (const [field, value] of Object.entries(values)) {
                if (constraints[field]?.includes('UNIQUE')) {
                    const existingValues = db[table][field] || [];
                    if (existingValues.includes(value)) {
                        throw new Error(`UNIQUE constraint violation: ${field} = ${value}`);
                    }
                }
            }
            
            Object.entries(values).forEach(([field, value]) => {
                if (!db[table][field]) db[table][field] = [];
                db[table][field].push(value);
            });
            const dbString = JSON.stringify(db, null, 2);
            writeDB(dbval, dbString);
            releaseLock(dbval);
        }
    } catch (error) {
        releaseLock(dbval);
        throw error;
    }
}

function checkForVals(dbval, table) {
    const db = getDB(dbval);
    const result = Object.prototype.hasOwnProperty.call(db, table);
    return result;
}

function getTable(dbval, table) {
    acquireLock(dbval, 'soft');
    try {
        const db = getDB(dbval);
        const result = db[table] || {};
        releaseLock(dbval);
        return result;
    } catch (error) {
        releaseLock(dbval);
        throw error;
    }
}

function dropTable(dbval, table, useWorker = false) {
    acquireLock(dbval, 'full');
    try {
        if (useWorker && isMainThread) {
            return new Promise((resolve, reject) => {
                const worker = new Worker(__filename, {
                    workerData: { action: 'dropTable', dbval, table }
                });
                worker.on('message', (result) => {
                    releaseLock(dbval);
                    resolve(result);
                });
                worker.on('error', (err) => {
                    releaseLock(dbval);
                    reject(err);
                });
                worker.on('exit', (code) => {
                    releaseLock(dbval);
                    if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                });
            });
        } else {
            const db = getDB(dbval);
            if (db[table]) {
                delete db[table];
                writeDB(dbval, JSON.stringify(db, null, 2));
            }
            releaseLock(dbval);
        }
    } catch (error) {
        releaseLock(dbval);
        throw error;
    }
}

if (!isMainThread && parentPort) {
    const { action, db, write, dbval, table, values } = workerData;
    if (action === 'writeDB') {
        fs.writeFileSync(db, write, function (err) {
            if (err) parentPort.postMessage({ error: err });
            else parentPort.postMessage({ success: true });
        });
    } else if (action === 'addValue') {
        try {
            const dbObj = getDB(dbval);
            if (!dbObj[table]) dbObj[table] = {};
            const constraints = dbObj._constraints?.[table] || {};
            for (const [field, value] of Object.entries(values)) {
                if (constraints[field]?.includes('UNIQUE')) {
                    const existingValues = dbObj[table][field] || [];
                    if (existingValues.includes(value)) {
                        parentPort.postMessage({ error: `UNIQUE constraint violation: ${field} = ${value}` });
                        process.exit(0);
                    }
                }
            }
            
            Object.entries(values).forEach(([field, value]) => {
                if (!dbObj[table][field]) dbObj[table][field] = [];
                dbObj[table][field].push(value);
            });
            const dbString = JSON.stringify(dbObj, null, 2);
            fs.writeFileSync(dbval, dbString, function (err) {
                if (err) parentPort.postMessage({ error: err });
                else parentPort.postMessage({ success: true });
            });
        } catch (error) {
            parentPort.postMessage({ error: error.message });
        }
    } else if (action === 'dropTable') {
        const dbObj = getDB(dbval);
        if (dbObj[table]) {
            delete dbObj[table];
            fs.writeFileSync(dbval, JSON.stringify(dbObj, null, 2), function (err) {
                if (err) parentPort.postMessage({ error: err });
                else parentPort.postMessage({ success: true });
            });
        } else {
            parentPort.postMessage({ success: true });
        }
    }
}

function createTable(dbval, table, columns = []) {
    acquireLock(dbval, 'soft');
    try {
        const db = getDB(dbval);
        if (!db[table]) {
            db[table] = {};
            for (const col of columns) {
                db[table][col] = [];
            }
            writeDB(dbval, JSON.stringify(db, null, 2));
        }
        releaseLock(dbval);
    } catch (error) {
        releaseLock(dbval);
        throw error;
    }
}

function addConstraint(dbval, table, field, constraint) {
    acquireLock(dbval, 'soft');
    try {
        const db = getDB(dbval);
        if (!db._constraints) db._constraints = {};
        if (!db._constraints[table]) db._constraints[table] = {};
        if (!db._constraints[table][field]) db._constraints[table][field] = [];
        if (!db._constraints[table][field].includes(constraint)) {
            db._constraints[table][field].push(constraint);
            writeDB(dbval, JSON.stringify(db, null, 2));
        }
        releaseLock(dbval);
    } catch (error) {
        releaseLock(dbval);
        throw error;
    }
}

export { createDB, getDB, writeDB, addValue, checkForVals, createTable, getTable, dropTable, addConstraint };