export const DBOPFS_STUDIO_PROTOCOL='dbopfs-studio';
export const DBOPFS_STUDIO_PROTOCOL_VERSION=1;
export const DBOPFS_STUDIO_AGENT_ATTRIBUTE='data-dbopfs-studio-agent';
export const DBOPFS_STUDIO_DEFAULT_TIMEOUT=60_000;
export const DBOPFS_STUDIO_DEFAULT_MAX_BYTES=8*1024*1024;
export const DBOPFS_STUDIO_MAX_BYTES=32*1024*1024;

export const DBOPFS_STUDIO_OPERATIONS=Object.freeze({
    PING:'ping',
    CONNECT:'connect',
    SCAN:'scan',
    DASHBOARD:'dashboard',
    READ_RECORD:'record.read',
    WRITE_RECORD:'record.write',
    CREATE:'create',
    DELETE:'delete',
    EXPORT:'export',
    RAW_LIST:'raw.list',
    RAW_READ:'raw.read',
    RAW_WRITE:'raw.write'
});

const OPERATIONS=new Set(Object.values(DBOPFS_STUDIO_OPERATIONS));
const APPLICATION_ID_PATTERN=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REQUEST_ID_PATTERN=/^[A-Za-z0-9._:-]{1,160}$/;

function protocolError(code,message){
    const error=new Error(message);
    error.name='DBOPFSStudioProtocolError';
    error.code=code;
    return error;
}

export function createRequestId(){
    if(typeof globalThis.crypto?.randomUUID==='function'){
        return globalThis.crypto.randomUUID();
    }

    const random=Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${random}`;
}

export function assertApplicationId(value,label='applicationId'){
    if(typeof value!=='string'
        ||value.length<1
        ||value.length>64
        ||!APPLICATION_ID_PATTERN.test(value)){
        throw protocolError(
            'INVALID_APPLICATION_ID',
            `${label} must be a canonical lowercase DBOPFS application ID.`
        );
    }

    return value;
}

export function assertEntryName(value,label='name'){
    if(typeof value!=='string'
        ||value.length<1
        ||value.length>255
        ||value==='.'
        ||value==='..'
        ||value.includes('/')
        ||value.includes('\\')
        ||value.includes('\0')){
        throw protocolError(
            'INVALID_ENTRY_NAME',
            `${label} must be one safe OPFS path segment.`
        );
    }

    return value;
}

export function normalizeRawPath(value=[]){
    let segments=value;

    if(typeof value==='string'){
        segments=value.split('/').filter(Boolean);
    }

    if(!Array.isArray(segments)||segments.length>64){
        throw protocolError(
            'INVALID_RAW_PATH',
            'A raw OPFS path must contain no more than 64 segments.'
        );
    }

    return segments.map(
        (segment,index)=>assertEntryName(segment,`path[${index}]`)
    );
}

export function clampByteLimit(value,defaultValue=DBOPFS_STUDIO_DEFAULT_MAX_BYTES){
    if(value===undefined||value===null||value===''){
        return defaultValue;
    }

    const limit=Number(value);

    if(!Number.isSafeInteger(limit)||limit<1||limit>DBOPFS_STUDIO_MAX_BYTES){
        throw protocolError(
            'INVALID_BYTE_LIMIT',
            `maxBytes must be an integer from 1 to ${DBOPFS_STUDIO_MAX_BYTES}.`
        );
    }

    return limit;
}

export function createRequest(operation,payload={},requestId=createRequestId()){
    if(!OPERATIONS.has(operation)){
        throw protocolError('UNKNOWN_OPERATION',`Unknown operation: ${operation}`);
    }

    if(!REQUEST_ID_PATTERN.test(String(requestId))){
        throw protocolError('INVALID_REQUEST_ID','The request ID is invalid.');
    }

    if(payload===null||typeof payload!=='object'||Array.isArray(payload)){
        throw protocolError('INVALID_PAYLOAD','The request payload must be an object.');
    }

    return {
        protocol:DBOPFS_STUDIO_PROTOCOL,
        version:DBOPFS_STUDIO_PROTOCOL_VERSION,
        type:'request',
        requestId:String(requestId),
        operation,
        payload
    };
}

export function isProtocolMessage(value){
    return Boolean(
        value
        &&typeof value==='object'
        &&value.protocol===DBOPFS_STUDIO_PROTOCOL
        &&value.version===DBOPFS_STUDIO_PROTOCOL_VERSION
    );
}

export function assertRequest(value){
    if(!isProtocolMessage(value)
        ||value.type!=='request'
        ||!REQUEST_ID_PATTERN.test(String(value.requestId||''))
        ||!OPERATIONS.has(value.operation)
        ||value.payload===null
        ||typeof value.payload!=='object'
        ||Array.isArray(value.payload)){
        throw protocolError('INVALID_REQUEST','The DBOPFS Studio request is invalid.');
    }

    return value;
}

export function createSuccessResponse(request,result){
    return {
        protocol:DBOPFS_STUDIO_PROTOCOL,
        version:DBOPFS_STUDIO_PROTOCOL_VERSION,
        type:'response',
        requestId:request.requestId,
        operation:request.operation,
        ok:true,
        result
    };
}

export function serializeError(error){
    return {
        name:String(error?.name||'Error'),
        code:String(error?.code||'OPERATION_FAILED'),
        message:String(error?.message||error||'The operation failed.')
    };
}

export function createErrorResponse(request,error){
    return {
        protocol:DBOPFS_STUDIO_PROTOCOL,
        version:DBOPFS_STUDIO_PROTOCOL_VERSION,
        type:'response',
        requestId:String(request?.requestId||'invalid-request'),
        operation:String(request?.operation||'unknown'),
        ok:false,
        error:serializeError(error)
    };
}

export function responseError(response){
    const source=response?.error||{};
    const error=new Error(source.message||'DBOPFS Studio operation failed.');
    error.name=source.name||'DBOPFSStudioError';
    error.code=source.code||'OPERATION_FAILED';
    return error;
}

export function assertResponse(value,request){
    if(!isProtocolMessage(value)
        ||value.type!=='response'
        ||value.requestId!==request.requestId
        ||value.operation!==request.operation
        ||typeof value.ok!=='boolean'){
        throw protocolError('INVALID_RESPONSE','The DBOPFS Studio response is invalid.');
    }

    return value;
}
