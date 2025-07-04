import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

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

function writeDB(db, write, useWorker = false) {
    if (!fs.existsSync(db)) {
        createDB(db);
    }
    if (useWorker && isMainThread) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { action: 'writeDB', db, write }
            });
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    } else {
        fs.writeFileSync(db, write, function (err) {
            if (err) {
                console.log(err);
            }
        });
    }
}

function addValue(dbval, table, values, useWorker = false) {
    if (useWorker && isMainThread) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { action: 'addValue', dbval, table, values }
            });
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    } else {
        const db = getDB(dbval);
        if (!db[table]) db[table] = {};
        Object.entries(values).forEach(([field, value]) => {
            if (!db[table][field]) db[table][field] = [];
            db[table][field].push(value);
        });
        const dbString = JSON.stringify(db, null, 2);
        writeDB(dbval, dbString);
    }
}

function checkForVals(dbval, table) {
    const db = getDB(dbval);
    const result = Object.prototype.hasOwnProperty.call(db, table);
    return result;
}

function getTable(dbval, table) {
    const db = getDB(dbval);
    return db[table] || {};
}

function dropTable(dbval, table, useWorker = false) {
    if (useWorker && isMainThread) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { action: 'dropTable', dbval, table }
            });
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    } else {
        const db = getDB(dbval);
        if (db[table]) {
            delete db[table];
            writeDB(dbval, JSON.stringify(db, null, 2));
        }
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
        const dbObj = getDB(dbval);
        if (!dbObj[table]) dbObj[table] = {};
        Object.entries(values).forEach(([field, value]) => {
            if (!dbObj[table][field]) dbObj[table][field] = [];
            dbObj[table][field].push(value);
        });
        const dbString = JSON.stringify(dbObj, null, 2);
        fs.writeFileSync(dbval, dbString, function (err) {
            if (err) parentPort.postMessage({ error: err });
            else parentPort.postMessage({ success: true });
        });
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
    const db = getDB(dbval);
    if (!db[table]) {
        db[table] = {};
        for (const col of columns) {
            db[table][col] = [];
        }
        writeDB(dbval, JSON.stringify(db, null, 2));
    }
}

export { createDB, getDB, writeDB, addValue, checkForVals, createTable, getTable, dropTable };