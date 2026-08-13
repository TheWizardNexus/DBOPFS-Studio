(function bootstrapDBOPFSStudio(){
    const PROTOCOL='dbopfs-studio';
    const VERSION=1;
    const AGENT_ATTRIBUTE='data-dbopfs-studio-agent';
    const pending=new Map();
    let agentPromise=null;

    function bridgeError(code,message){
        const error=new Error(message);
        error.name='DBOPFSStudioBridgeError';
        error.code=code;
        return error;
    }

    function requestId(){
        return typeof crypto.randomUUID==='function'
            ?crypto.randomUUID()
            :`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function legacyRequest(message){
        const data=message.data||{};
        const operation={
            scan:'scan',
            dashboard:'dashboard',
            readRecord:'record.read',
            writeRecord:'record.write',
            createApplication:'create',
            createTable:'create',
            createRecord:'create',
            deleteRecord:'delete',
            deleteTable:'delete',
            export:'export',
            rawList:'raw.list',
            rawRead:'raw.read',
            rawWrite:'raw.write'
        }[message.action];

        if(!operation){
            throw bridgeError('UNKNOWN_OPERATION',`Unknown operation: ${message.action}`);
        }

        const payload={...data};

        if(payload.table!==undefined&&payload.tableName===undefined){
            payload.tableName=payload.table;
        }

        if(payload.record!==undefined&&payload.fileName===undefined){
            payload.fileName=payload.record;
        }

        if(message.action==='createApplication'){
            payload.kind='application';
        }else if(message.action==='createTable'){
            payload.kind='table';
        }else if(message.action==='createRecord'){
            payload.kind='record';
            payload.value=payload.text??'';
        }else if(message.action==='deleteRecord'){
            payload.kind='record';
        }else if(message.action==='deleteTable'){
            payload.kind='table';
        }

        return {
            protocol:PROTOCOL,
            version:VERSION,
            type:'request',
            requestId:requestId(),
            operation,
            payload
        };
    }

    function normalizeRequest(message){
        if(message?.protocol===PROTOCOL
            &&message.version===VERSION
            &&message.type==='request'){
            return {request:message,legacy:false};
        }

        if(message?.channel===PROTOCOL&&message.version===VERSION){
            return {request:legacyRequest(message),legacy:true};
        }

        return null;
    }

    async function loadAgent(){
        if(!agentPromise){
            document.documentElement.setAttribute(AGENT_ATTRIBUTE,'loading');
            agentPromise=import(chrome.runtime.getURL('agent/dbopfs-page-agent.js'))
                .then(module=>{
                    if(typeof module.handleStudioRequest!=='function'){
                        throw bridgeError(
                            'INVALID_PAGE_AGENT',
                            'The DBOPFS Studio page agent has no request handler.'
                        );
                    }

                    document.documentElement.setAttribute(AGENT_ATTRIBUTE,'ready');
                    return module;
                })
                .catch(error=>{
                    document.documentElement.setAttribute(AGENT_ATTRIBUTE,'error');
                    throw error;
                });
        }

        return agentPromise;
    }

    async function dispatchRequest(request){
        const agent=await loadAgent();
        return agent.handleStudioRequest(request);
    }

    chrome.runtime.onMessage.addListener(function studioMessage(message,_sender,sendResponse){
        let normalized;

        try{
            normalized=normalizeRequest(message);
        }catch(error){
            sendResponse({
                ok:false,
                error:{
                    name:error.name,
                    code:error.code||'INVALID_REQUEST',
                    message:error.message
                }
            });
            return false;
        }

        if(!normalized){
            return false;
        }

        const {request,legacy}=normalized;
        const timeoutId=setTimeout(()=>{
            const entry=pending.get(request.requestId);

            if(!entry){
                return;
            }

            pending.delete(request.requestId);
            entry.resolve(legacy
                ?{ok:false,error:{code:'AGENT_TIMEOUT',message:'The page agent did not answer.'}}
                :{
                    protocol:PROTOCOL,
                    version:VERSION,
                    type:'response',
                    requestId:request.requestId,
                    operation:request.operation,
                    ok:false,
                    error:{
                        name:'DBOPFSStudioBridgeError',
                        code:'AGENT_TIMEOUT',
                        message:'The page agent did not answer.'
                    }
                });
        },60_000);

        pending.set(request.requestId,{
            legacy,
            timeoutId,
            resolve:sendResponse
        });

        dispatchRequest(request).then(response=>{
            const entry=pending.get(request.requestId);

            if(!entry){
                return;
            }

            pending.delete(request.requestId);
            clearTimeout(entry.timeoutId);
            entry.resolve(entry.legacy
                ?(response.ok
                    ?{ok:true,data:response.result}
                    :{ok:false,error:response.error})
                :response);
        }).catch(error=>{
            const entry=pending.get(request.requestId);

            if(!entry){
                return;
            }

            pending.delete(request.requestId);
            clearTimeout(entry.timeoutId);
            const serialized={
                name:error?.name||'DBOPFSStudioBridgeError',
                code:error?.code||'AGENT_LOAD_FAILED',
                message:error?.message||'The DBOPFS Studio agent could not load.'
            };
            entry.resolve(entry.legacy
                ?{ok:false,error:serialized}
                :{
                    protocol:PROTOCOL,
                    version:VERSION,
                    type:'response',
                    requestId:request.requestId,
                    operation:request.operation,
                    ok:false,
                    error:serialized
                });
        });
        return true;
    });
})();
