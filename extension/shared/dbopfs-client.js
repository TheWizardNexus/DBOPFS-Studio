import {
    DBOPFS_STUDIO_DEFAULT_TIMEOUT,
    DBOPFS_STUDIO_OPERATIONS,
    assertResponse,
    createRequest,
    responseError
} from './dbopfs-protocol.js';

function clientError(code,message){
    const error=new Error(message);
    error.name='DBOPFSStudioClientError';
    error.code=code;
    return error;
}

function invokeChrome(target,method,args=[]){
    return new Promise(function invokeChromePromise(resolve,reject){
        let settled=false;

        function finish(error,value){
            if(settled){
                return;
            }

            settled=true;
            error?reject(error):resolve(value);
        }

        function callback(value){
            const lastError=globalThis.chrome?.runtime?.lastError;
            finish(lastError?new Error(lastError.message):null,value);
        }

        try{
            const returned=target[method](...args,callback);

            if(returned&&typeof returned.then==='function'){
                returned.then(
                    value=>finish(null,value),
                    error=>finish(error)
                );
            }
        }catch(error){
            finish(error);
        }
    });
}

export class DBOPFSStudioClient {
    constructor({
        tabId=null,
        chromeApi=globalThis.chrome,
        timeout=DBOPFS_STUDIO_DEFAULT_TIMEOUT,
        autoInject=true
    }={}){
        this.tabId=tabId;
        this.chromeApi=chromeApi;
        this.timeout=timeout;
        this.autoInject=autoInject;
        this.injected=false;
    }

    async resolveTabId(){
        if(Number.isInteger(this.tabId)){
            return this.tabId;
        }

        if(!this.chromeApi?.tabs?.query){
            throw clientError('TABS_API_UNAVAILABLE','The Chromium tabs API is unavailable.');
        }

        const tabs=await invokeChrome(
            this.chromeApi.tabs,
            'query',
            [{active:true,currentWindow:true}]
        );
        const tabId=tabs?.[0]?.id;

        if(!Number.isInteger(tabId)){
            throw clientError('NO_ACTIVE_TAB','DBOPFS Studio could not find an active tab.');
        }

        this.tabId=tabId;
        return tabId;
    }

    async ensureAgent(){
        if(this.injected||!this.autoInject){
            return;
        }

        // The Manifest V3 content script loads the bridge on allowed HTTP(S)
        // pages. Studio never needs dynamic code-injection permission.
        await this.resolveTabId();
        this.injected=true;
    }

    async request(operation,payload={}){
        await this.ensureAgent();
        const tabId=await this.resolveTabId();
        const request=createRequest(operation,payload);
        let timeoutId;

        const timeoutPromise=new Promise((_,reject)=>{
            timeoutId=setTimeout(
                ()=>reject(clientError(
                    'REQUEST_TIMEOUT',
                    `DBOPFS Studio did not answer ${operation} within ${this.timeout} ms.`
                )),
                this.timeout
            );
        });

        try{
            const response=await Promise.race([
                invokeChrome(
                    this.chromeApi.tabs,
                    'sendMessage',
                    [tabId,request]
                ),
                timeoutPromise
            ]);
            assertResponse(response,request);

            if(!response.ok){
                throw responseError(response);
            }

            return response.result;
        }finally{
            clearTimeout(timeoutId);
        }
    }

    ping(){
        return this.request(DBOPFS_STUDIO_OPERATIONS.PING);
    }

    connect(applicationIdOrOptions={}){
        const payload=typeof applicationIdOrOptions==='string'
            ?{applicationId:applicationIdOrOptions}
            :applicationIdOrOptions;
        return this.request(DBOPFS_STUDIO_OPERATIONS.CONNECT,payload);
    }

    scan(options={}){
        return this.request(DBOPFS_STUDIO_OPERATIONS.SCAN,options);
    }

    getDashboard(options={}){
        return this.request(DBOPFS_STUDIO_OPERATIONS.DASHBOARD,options);
    }

    readRecord(tableName,fileName,options={}){
        return this.request(
            DBOPFS_STUDIO_OPERATIONS.READ_RECORD,
            {...options,tableName,fileName}
        );
    }

    writeRecord(tableName,fileName,value,options={}){
        return this.request(
            DBOPFS_STUDIO_OPERATIONS.WRITE_RECORD,
            {...options,tableName,fileName,value}
        );
    }

    create(specification={}){
        return this.request(DBOPFS_STUDIO_OPERATIONS.CREATE,specification);
    }

    createApplication(applicationId){
        return this.create({kind:'application',applicationId});
    }

    delete(specification={}){
        return this.request(DBOPFS_STUDIO_OPERATIONS.DELETE,specification);
    }

    export(options={}){
        return this.request(DBOPFS_STUDIO_OPERATIONS.EXPORT,options);
    }

    rawList(path=[],options={}){
        return this.request(
            DBOPFS_STUDIO_OPERATIONS.RAW_LIST,
            {...options,path}
        );
    }

    rawRead(path,options={}){
        return this.request(
            DBOPFS_STUDIO_OPERATIONS.RAW_READ,
            {...options,path}
        );
    }

    rawWrite(path,data,options={}){
        return this.request(
            DBOPFS_STUDIO_OPERATIONS.RAW_WRITE,
            {...options,path,data}
        );
    }
}

export function createDBOPFSStudioClient(options={}){
    return new DBOPFSStudioClient(options);
}

if(typeof window!=='undefined'){
    window.DBOPFSStudioClient=DBOPFSStudioClient;
}
