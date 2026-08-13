import DBOPFS from '../vendor/dbopfs/arcane/modules/DBOPFSStudio.js';
import {
    DBOPFS_STUDIO_DEFAULT_MAX_BYTES,
    DBOPFS_STUDIO_MAX_BYTES,
    DBOPFS_STUDIO_OPERATIONS,
    assertApplicationId,
    assertEntryName,
    assertRequest,
    clampByteLimit,
    createErrorResponse,
    createSuccessResponse,
    normalizeRawPath
} from '../shared/dbopfs-protocol.js';

const MODULE_VERSION='1.0.0';
const textEncoder=new TextEncoder();
const databases=new Map();
const databaseLoads=new Map();
const applicationMutations=new Map();
let rawMutation=Promise.resolve();

function studioError(code,message,name='DBOPFSStudioError'){
    const error=new Error(message);
    error.name=name;
    error.code=code;
    return error;
}

function assertMainThreadOPFS(){
    if(typeof navigator.storage?.getDirectory!=='function'){
        throw studioError(
            'OPFS_UNAVAILABLE',
            'This origin does not expose the Origin Private File System.',
            'NotSupportedError'
        );
    }

    if(typeof FileSystemFileHandle==='undefined'
        ||typeof FileSystemFileHandle.prototype?.getFile!=='function'
        ||typeof FileSystemFileHandle.prototype?.createWritable!=='function'){
        throw studioError(
            'SAFE_FILE_IO_UNAVAILABLE',
            'DBOPFS Studio requires document-thread OPFS file I/O in the connected site context. The vendored module worker fallback is intentionally disabled because an extension-loaded worker would use extension-origin storage.',
            'NotSupportedError'
        );
    }
}

function validateTableAndFile(payload){
    return {
        tableName:assertEntryName(payload.tableName??payload.table,'tableName'),
        fileName:assertEntryName(payload.fileName??payload.record,'fileName')
    };
}

function declaredApplicationId(){
    return document.querySelector('meta[name="arcane-app-id"]')?.getAttribute('content')
        ||document.documentElement?.dataset?.arcaneAppId
        ||null;
}

async function databaseFor(applicationId,{create=false}={}){
    assertMainThreadOPFS();
    const id=assertApplicationId(applicationId);

    if(databases.has(id)){
        return databases.get(id);
    }

    const pending=databaseLoads.get(id);

    if(pending){
        try{
            return await pending.promise;
        }catch(error){
            if(!create){
                throw error;
            }
        }
    }

    const promise=(async function loadDatabase(){
        // The Studio adapter preserves the DBOPFS class while disabling its
        // global singleton behavior. `create` is true only for the explicit
        // application-creation command.
        const database=new DBOPFS({
            applicationId:id,
            documentObject:null,
            arcane:null,
            storage:navigator.storage,
            create,
            initializeDefaultTables:false,
            singleton:false,
            dispatchReadyEvent:false
        });
        await database.readyPromise;
        await database.getTableNames(true);
        return database;
    })();
    const load={create,promise};
    databaseLoads.set(id,load);

    let database;

    try{
        database=await promise;
    }finally{
        if(databaseLoads.get(id)===load){
            databaseLoads.delete(id);
        }
    }

    databases.set(id,database);
    return database;
}

function queueApplicationMutation(applicationId,operation){
    const previous=applicationMutations.get(applicationId)||Promise.resolve();
    const current=previous.catch(()=>{}).then(operation);
    applicationMutations.set(applicationId,current);

    function cleanup(){
        if(applicationMutations.get(applicationId)===current){
            applicationMutations.delete(applicationId);
        }
    }

    current.then(cleanup,cleanup);
    return current;
}

async function waitForApplicationMutation(applicationId){
    await (applicationMutations.get(applicationId)||Promise.resolve()).catch(()=>{});
}

async function waitForAllMutations(){
    await Promise.all(
        [...applicationMutations.values()].map(promise=>promise.catch(()=>{}))
    );
    await rawMutation.catch(()=>{});
}

function queueRawMutation(operation){
    const current=rawMutation.catch(()=>{}).then(operation);
    rawMutation=current;
    return current;
}

async function assertTableExists(database,tableName){
    const tableNames=await database.getTableNames(true);

    if(!tableNames.includes(tableName)){
        throw studioError(
            'TABLE_NOT_FOUND',
            `DBOPFS table '${tableName}' does not exist.`,
            'NotFoundError'
        );
    }
}

function invalidateRecordCache(database,tableName,fileName){
    if(database.tables[tableName]){
        delete database.tables[tableName][fileName];
    }
}

async function getRoot(){
    assertMainThreadOPFS();
    return navigator.storage.getDirectory();
}

async function openRawDirectory(path,{create=false}={}){
    const segments=normalizeRawPath(path);
    let directory=await getRoot();

    for(const segment of segments){
        directory=await directory.getDirectoryHandle(segment,{create});
    }

    return directory;
}

async function openRawFile(path,{create=false}={}){
    const segments=normalizeRawPath(path);

    if(!segments.length){
        throw studioError('RAW_FILE_REQUIRED','A raw file path is required.');
    }

    const fileName=segments.pop();
    const directory=await openRawDirectory(segments,{create});
    return directory.getFileHandle(fileName,{create});
}

function bytesToBase64(bytes){
    let result='';
    const size=0x8000;

    for(let offset=0;offset<bytes.length;offset+=size){
        result+=String.fromCharCode(...bytes.subarray(offset,offset+size));
    }

    return btoa(result);
}

function base64ToBytes(value){
    if(typeof value!=='string'||value.length>Math.ceil((32*1024*1024)*4/3)+8){
        throw studioError('INVALID_BASE64','The base64 payload is invalid or too large.');
    }

    let binary;

    try{
        binary=atob(value);
    }catch{
        throw studioError('INVALID_BASE64','The base64 payload is invalid.');
    }

    const bytes=new Uint8Array(binary.length);

    for(let index=0;index<binary.length;index++){
        bytes[index]=binary.charCodeAt(index);
    }

    return bytes;
}

function payloadBytes(payload){
    if(payload.base64!==undefined){
        return base64ToBytes(payload.base64);
    }

    if(payload.text!==undefined){
        return textEncoder.encode(String(payload.text));
    }

    if(payload.data!==undefined){
        if(typeof payload.data==='string'){
            return textEncoder.encode(payload.data);
        }

        if(Array.isArray(payload.data)){
            return new Uint8Array(payload.data);
        }
    }

    if(payload.value!==undefined){
        return textEncoder.encode(
            typeof payload.value==='string'
                ?payload.value
                :JSON.stringify(payload.value)
        );
    }

    return new Uint8Array();
}

function assertPayloadSize(bytes){
    if(!(bytes instanceof Uint8Array)
        ||bytes.byteLength>32*1024*1024){
        throw studioError(
            'PAYLOAD_TOO_LARGE',
            'Write payloads may not exceed 32 MiB.'
        );
    }

    return bytes;
}

function isTextFile(file,fileName=''){
    return file.type.startsWith('text/')
        ||/\.(?:c|cc|conf|cpp|css|csv|h|hpp|htm|html|ini|java|js|json|jsonl|log|md|mjs|ndjson|py|rb|rs|sh|svg|toml|txt|xml|yaml|yml)$/i.test(fileName);
}

async function filePayload(file,fileName,{maxBytes=DBOPFS_STUDIO_DEFAULT_MAX_BYTES}={}){
    const limit=clampByteLimit(maxBytes);

    if(file.size>limit){
        throw studioError(
            'FILE_TOO_LARGE',
            `${fileName||file.name} is ${file.size} bytes; the current read limit is ${limit} bytes.`
        );
    }

    const common={
        name:fileName||file.name,
        type:file.type||'',
        size:file.size,
        lastModified:file.lastModified||null
    };

    if(isTextFile(file,fileName)){
        return {...common,encoding:'text',text:await file.text()};
    }

    return {
        ...common,
        encoding:'base64',
        base64:bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    };
}

async function listApplications(){
    const root=await getRoot();
    let apps;

    try{
        apps=await root.getDirectoryHandle('apps',{create:false});
    }catch(error){
        if(error.name==='NotFoundError'){
            return [];
        }

        throw error;
    }

    const applicationIds=[];

    for await(const [name,handle] of apps.entries()){
        if(handle.kind==='directory'){
            try{
                applicationIds.push(assertApplicationId(name));
            }catch{
                // Non-canonical directories are raw OPFS entries, not DBOPFS apps.
            }
        }
    }

    return applicationIds.sort((left,right)=>left.localeCompare(right));
}

async function describeApplicationReadOnly(applicationId,{includeRecords=true}={}){
    const root=await getRoot();
    const applications=await root.getDirectoryHandle('apps',{create:false});
    const application=await applications.getDirectoryHandle(applicationId,{create:false});
    const tables=[];

    for await(const [tableName,tableHandle] of application.entries()){
        if(tableHandle.kind!=='directory'){
            continue;
        }

        const records=[];
        let recordCount=0;
        let size=0;

        for await(const [fileName,fileHandle] of tableHandle.entries()){
            if(fileHandle.kind!=='file'){
                continue;
            }

            const file=await fileHandle.getFile();
            recordCount++;
            size+=file.size;

            if(includeRecords){
                records.push({
                    name:fileName,
                    size:file.size,
                    type:file.type||'',
                    lastModified:file.lastModified||null
                });
            }
        }

        records.sort((left,right)=>left.name.localeCompare(right.name));
        tables.push({
            name:tableName,
            recordCount,
            size,
            records:includeRecords?records:undefined
        });
    }

    tables.sort((left,right)=>left.name.localeCompare(right.name));

    return {
        id:applicationId,
        storagePath:`apps/${applicationId}`,
        tableCount:tables.length,
        recordCount:tables.reduce((total,table)=>total+table.recordCount,0),
        size:tables.reduce((total,table)=>total+table.size,0),
        tables
    };
}

async function storageProfile(){
    const estimate=typeof navigator.storage.estimate==='function'
        ?await navigator.storage.estimate().catch(()=>({}))
        :{};
    const persisted=typeof navigator.storage.persisted==='function'
        ?await navigator.storage.persisted().catch(()=>false)
        :false;

    return {
        usage:estimate.usage??0,
        quota:estimate.quota??0,
        persisted,
        opfs:typeof navigator.storage.getDirectory==='function'
    };
}

async function scan(payload={}){
    await waitForAllMutations();
    const includeRecords=payload.includeRecords!==false;
    const applicationIds=await listApplications();
    const applications=[];

    for(const applicationId of applicationIds){
        applications.push(
            await describeApplicationReadOnly(applicationId,{includeRecords})
        );
    }

    return {
        origin:location.origin,
        inspectedUrl:location.href,
        declaredApplicationId:declaredApplicationId(),
        module:{
            name:'DBOPFS',
            version:MODULE_VERSION,
            ready:true,
            primaryDataLayer:true
        },
        storage:await storageProfile(),
        applications
    };
}

async function connect(payload={}){
    const selected=payload.applicationId
        ?assertApplicationId(payload.applicationId)
        :declaredApplicationId();

    if(!selected){
        return {
            origin:location.origin,
            connected:false,
            applicationIds:await listApplications(),
            reason:'Select a DBOPFS application namespace.'
        };
    }

    await waitForApplicationMutation(selected);
    const database=await databaseFor(selected);
    return {
        origin:location.origin,
        connected:true,
        applicationId:database.applicationId,
        storagePath:database.storagePath,
        module:{name:'DBOPFS',version:MODULE_VERSION,primaryDataLayer:true}
    };
}

async function readRecord(payload){
    const applicationId=assertApplicationId(payload.applicationId);
    const {tableName,fileName}=validateTableAndFile(payload);
    await waitForApplicationMutation(applicationId);
    const database=await databaseFor(applicationId);
    await assertTableExists(database,tableName);
    const file=await database.readFile(tableName,fileName);
    return filePayload(file,fileName,{maxBytes:payload.maxBytes});
}

async function writeRecordUnlocked(payload,applicationId){
    const {tableName,fileName}=validateTableAndFile(payload);
    const database=await databaseFor(applicationId);
    const bytes=payloadBytes(payload);
    assertPayloadSize(bytes);

    if(payload.expectedLastModified!==undefined
        &&payload.expectedLastModified!==null){
        const expected=Number(payload.expectedLastModified);

        if(!Number.isFinite(expected)||expected<0){
            throw studioError(
                'INVALID_EXPECTED_TIMESTAMP',
                'expectedLastModified must be a non-negative timestamp.'
            );
        }

        const metadata=await database.getFileMetadata(tableName,fileName);

        if(metadata.lastModified!==null&&metadata.lastModified!==expected){
            throw studioError(
                'RECORD_CHANGED',
                `DBOPFS record '${fileName}' changed after it was opened. Refresh it before saving.`
            );
        }
    }

    await database.writeFile(tableName,fileName,bytes,Boolean(payload.append));
    invalidateRecordCache(database,tableName,fileName);
    return {
        applicationId,
        tableName,
        fileName,
        metadata:await database.getFileMetadata(tableName,fileName)
    };
}

async function writeRecord(payload){
    const applicationId=assertApplicationId(payload.applicationId);
    return queueApplicationMutation(
        applicationId,
        ()=>writeRecordUnlocked(payload,applicationId)
    );
}

async function createApplication(applicationId){
    return queueApplicationMutation(applicationId,async function createApplicationLocked(){
        const existed=(await listApplications()).includes(applicationId);
        const database=await databaseFor(applicationId,{create:true});
        const tableNames=await database.getTableNames(true);

        return {
            applicationId:database.applicationId,
            storagePath:database.storagePath,
            kind:'application',
            created:!existed,
            tableCount:tableNames.length,
            module:{name:'DBOPFS',version:MODULE_VERSION,primaryDataLayer:true}
        };
    });
}

async function createEntry(payload){
    const applicationId=assertApplicationId(payload.applicationId);

    if(payload.kind==='application'){
        return createApplication(applicationId);
    }

    const tableName=assertEntryName(payload.tableName??payload.table,'tableName');

    if(payload.kind==='table'){
        return queueApplicationMutation(applicationId,async function createTableLocked(){
            const database=await databaseFor(applicationId);
            await database.getTableHandle(tableName);
            return {applicationId,kind:'table',tableName};
        });
    }

    if(payload.kind==='record'){
        return queueApplicationMutation(
            applicationId,
            ()=>writeRecordUnlocked(
                {...payload,applicationId,tableName,append:false},
                applicationId
            )
        );
    }

    throw studioError(
        'INVALID_CREATE_KIND',
        'Create kind must be application, table, or record.'
    );
}

async function deleteEntry(payload){
    const applicationId=assertApplicationId(payload.applicationId);
    const tableName=assertEntryName(payload.tableName??payload.table,'tableName');

    return queueApplicationMutation(applicationId,async function deleteEntryLocked(){
        const database=await databaseFor(applicationId);

        if(payload.kind==='table'){
            await assertTableExists(database,tableName);
            await database.deleteTable(tableName);

            if((await database.getTableNames(true)).includes(tableName)){
                throw studioError('DELETE_FAILED',`Could not delete table '${tableName}'.`);
            }

            return {applicationId,kind:'table',tableName,deleted:true};
        }

        if(payload.kind==='record'){
            const fileName=assertEntryName(payload.fileName??payload.record,'fileName');
            await assertTableExists(database,tableName);

            if(!await database.hasKey(tableName,fileName)){
                throw studioError(
                    'RECORD_NOT_FOUND',
                    `DBOPFS record '${fileName}' does not exist.`,
                    'NotFoundError'
                );
            }

            await database.delete(tableName,fileName);

            if(await database.hasKey(tableName,fileName)){
                throw studioError('DELETE_FAILED',`Could not delete record '${fileName}'.`);
            }

            return {applicationId,kind:'record',tableName,fileName,deleted:true};
        }

        throw studioError('INVALID_DELETE_KIND','Delete kind must be table or record.');
    });
}

async function exportDatabase(payload={}){
    const applicationId=assertApplicationId(payload.applicationId);
    await waitForApplicationMutation(applicationId);
    const database=await databaseFor(applicationId);
    const limit=clampByteLimit(payload.maxBytes,DBOPFS_STUDIO_MAX_BYTES);
    const tableNames=await database.getTableNames(true);
    let storedBytes=0;
    const value={};

    for(const tableName of tableNames){
        value[tableName]={};
        const table=await database.getTableHandle(tableName);
        const fileNames=[];

        for await(const [fileName,handle] of table.entries()){
            if(handle.kind==='file'){
                fileNames.push(fileName);
            }
        }

        fileNames.sort((left,right)=>left.localeCompare(right));

        for(const fileName of fileNames){
            const file=await database.readFile(tableName,fileName);
            storedBytes+=file.size;

            if(storedBytes>limit){
                throw studioError(
                    'EXPORT_TOO_LARGE',
                    `The DBOPFS application exceeds the ${limit}-byte export limit.`
                );
            }

            value[tableName][fileName]=await filePayload(file,fileName,{
                maxBytes:limit
            });
        }
    }

    const text=JSON.stringify({
        format:'dbopfs-studio-export',
        version:1,
        recordFormat:'binary-safe-descriptors',
        origin:location.origin,
        applicationId,
        exportedAt:new Date().toISOString(),
        value
    },null,payload.pretty===false?0:2);
    const size=textEncoder.encode(text).byteLength;

    if(size>limit){
        throw studioError(
            'EXPORT_TOO_LARGE',
            `The encoded DBOPFS export exceeds the ${limit}-byte transfer limit.`
        );
    }

    return {
        applicationId,
        fileName:`${applicationId}-dbopfs.json`,
        type:'application/json',
        encoding:'text',
        size,
        text
    };
}

async function rawList(payload={}){
    await rawMutation.catch(()=>{});
    const path=normalizeRawPath(payload.path||[]);
    const directory=await openRawDirectory(path,{create:false});
    const entries=[];

    for await(const [name,handle] of directory.entries()){
        if(handle.kind==='file'){
            const file=await handle.getFile();
            entries.push({
                name,
                kind:'file',
                size:file.size,
                type:file.type||'',
                lastModified:file.lastModified||null
            });
        }else{
            entries.push({name,kind:'directory'});
        }
    }

    entries.sort((left,right)=>{
        if(left.kind!==right.kind){
            return left.kind==='directory'?-1:1;
        }

        return left.name.localeCompare(right.name);
    });

    return {path,entries};
}

async function rawRead(payload={}){
    await rawMutation.catch(()=>{});
    const path=normalizeRawPath(payload.path);
    const handle=await openRawFile(path,{create:false});
    return {
        path,
        ...await filePayload(await handle.getFile(),path.at(-1),{
            maxBytes:payload.maxBytes
        })
    };
}

async function rawWrite(payload={}){
    const path=normalizeRawPath(payload.path);

    if(path.length>=2&&path[0]==='apps'){
        try{
            assertApplicationId(path[1]);
            throw studioError(
                'DBOPFS_PATH_REQUIRES_MODULE',
                'Raw writes are disabled inside canonical DBOPFS application namespaces. Use DBOPFS application, table, and record operations.'
            );
        }catch(error){
            if(error.code==='DBOPFS_PATH_REQUIRES_MODULE'){
                throw error;
            }
        }
    }

    return queueRawMutation(async function rawWriteLocked(){
        const bytes=payloadBytes(payload);
        assertPayloadSize(bytes);
        const handle=await openRawFile(path,{create:true});
        const writable=await handle.createWritable({
            keepExistingData:Boolean(payload.append)
        });

        try{
            if(payload.append){
                const file=await handle.getFile();
                await writable.seek(file.size);
            }

            await writable.write(bytes);
        }finally{
            await writable.close();
        }

        const file=await handle.getFile();
        return {
            path,
            size:file.size,
            type:file.type||'',
            lastModified:file.lastModified||null
        };
    });
}

const handlers={
    [DBOPFS_STUDIO_OPERATIONS.PING]:async()=>({
        origin:location.origin,
        module:'DBOPFS',
        moduleVersion:MODULE_VERSION,
        protocolVersion:1
    }),
    [DBOPFS_STUDIO_OPERATIONS.CONNECT]:connect,
    [DBOPFS_STUDIO_OPERATIONS.SCAN]:scan,
    [DBOPFS_STUDIO_OPERATIONS.DASHBOARD]:scan,
    [DBOPFS_STUDIO_OPERATIONS.READ_RECORD]:readRecord,
    [DBOPFS_STUDIO_OPERATIONS.WRITE_RECORD]:writeRecord,
    [DBOPFS_STUDIO_OPERATIONS.CREATE]:createEntry,
    [DBOPFS_STUDIO_OPERATIONS.DELETE]:deleteEntry,
    [DBOPFS_STUDIO_OPERATIONS.EXPORT]:exportDatabase,
    [DBOPFS_STUDIO_OPERATIONS.RAW_LIST]:rawList,
    [DBOPFS_STUDIO_OPERATIONS.RAW_READ]:rawRead,
    [DBOPFS_STUDIO_OPERATIONS.RAW_WRITE]:rawWrite
};

export async function handleStudioRequest(message){
    let request=message;

    try{
        request=assertRequest(request);
        const handler=handlers[request.operation];
        return createSuccessResponse(request,await handler(request.payload));
    }catch(error){
        return createErrorResponse(request,error);
    }
}
