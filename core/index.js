
function create(setState, baseUrl, formData) {
    setState(prevState => {
        const url = baseUrl + '/form';
    const form = guidGenerator();

    fetchJSONRequest(url, {
        action: 'create',
        form: form,
        //navigator : 'external', //optional
        data: formData
    }, response => {
        createReceived(response, setState);
});

    return {
        url : url,
        form : form,
        requestIndex : -1, // last sent request index
        lastReceivedRequestIndex : -2,
        pendingChanges : []
    };
});
}

function createReceived(response, setState) {
    setState(prevState => {
        // it's always first to be proceed
        fetchNewIds(setState, prevState);
    return {...response.initial, lastReceivedRequestIndex: -1, genIDs: [], usedGenID: 0, meta: response.meta};
});
}

// need this to have nulls and not undef
function createNewObject(value, state, groupObject) {
    const newObject = { value : value };
    for(const prop in state.meta[groupObject])
        newObject[prop] = null;
    return newObject;
}
function hasNewDelete(state, groupObject, changesGroupObject) {
    let meta = state.meta[groupObject];
    for(const propOrAction in changesGroupObject) {
        if(propOrAction !== "value")
            return meta[propOrAction].newDelete;
    }
    return null;
}

function fetchNewIds(setState, prevState) {
    let count = 5;
    if (prevState.genIDs == null || prevState.usedGenID + count >= prevState.genIDs.length) {
        fetchJSONRequest(prevState.url, {
            action: "genids",
            count: count
        }, response => {
            setState(prevState => {
            let newGenIDs = [...prevState.genIDs]; // cutting used and adding new
        newGenIDs.splice(0, prevState.usedGenID);
        newGenIDs = newGenIDs.concat(response);
        return {
            usedGenID: 0,
            genIDs: newGenIDs
        }
    });
    });
    }
}

function genID(setState, prevState, updateState) {
    // fetching id generation
    fetchNewIds(setState, prevState);

    if(prevState.usedGenID < prevState.genIDs.length) {
        updateState.usedGenID = prevState.usedGenID + 1;
        return prevState.genIDs[prevState.usedGenID];
    }
    return null;
}

function isUndef(value) { // null is also a change so we need to check for undefined
    return typeof value === 'undefined';
}

// modify changes the way that if there is no set or currentvalue, put there current value (as array)
function modifyCurrentGroupObjects(setState, prevState, changes, updateState) {
    for (const groupObject in prevState.meta) {
        let changesGroupObject = changes[groupObject];
        if(changesGroupObject == null) { // shallow value (isShallow - will return true)
            changesGroupObject = {};
            changes[groupObject] = changesGroupObject;
        }

        let newDelete = hasNewDelete(prevState, groupObject, changesGroupObject);
        if(newDelete != null) {
            if (newDelete) { // NEW
                if(!isUndef(changesGroupObject.value))
                    throw "There should be no value for NEW action";
                let newID = updateState == null ? null : genID(setState, prevState, updateState); // generating id
                if(newID != null)
                    changesGroupObject.value = newID;
                else
                    return false;
            } else { // DELETE
                if(!isUndef(changesGroupObject.value) && changesGroupObject.value.constructor !== Array)
                    throw "There should be no value set for DELETE action";
            }
        }

        if(isUndef(changesGroupObject.value)) // setting current value in change
            changesGroupObject.value = [prevState[groupObject].value];
    }
    return true;
}

// this call may change changes object, last parameter can be null (however usually it's better to provide it to get WYSIWYG)
function change(setState, changes, currentState) {

    if(currentState != null)
        modifyCurrentGroupObjects(setState, currentState, changes, null);

    setState(prevState => {

        let updateState = {};
    if(prevState.lastReceivedRequestIndex === -2 || !modifyCurrentGroupObjects(setState, prevState, changes, updateState)) { // form is not created yet or we have no new ids
        postpone(() => change(setState, changes, currentState));
        return updateState;
    }

    const requestIndex = prevState.requestIndex + 1;

    fetchJSONRequest(prevState.url, {
        action: 'change',
        form: prevState.form,
        requestIndex: requestIndex,
        lastReceivedRequestIndex: prevState.lastReceivedRequestIndex,
        data: changes
    }, response => changeReceived(response, setState, requestIndex));

    updateState.requestIndex = requestIndex;
    updateRequest(updateState, prevState, changes);
    updateState.pendingChanges  = prevState.pendingChanges.concat(changes);
    return updateState;
});
}

function postpone(action) {
    setTimeout(action, 100);
}

function formCreated(state) {
    return state.lastReceivedRequestIndex != null && state.lastReceivedRequestIndex >= -1;
}

function numberOfPendingRequests(state) {
    return state.requestIndex - state.lastReceivedRequestIndex;
}

function changeReceived(response, setState, requestIndex) {
    setState(prevState => {
        if (prevState.lastReceivedRequestIndex + 1 < requestIndex) { // if it's not the last request, will wait and proceed next time
        postpone(() => { changeReceived(response, setState, requestIndex) });
        return {}; // no changes
    }

    let updateState = { lastReceivedRequestIndex : requestIndex };
    let responseModify = response.modify;
    updateResponse(updateState, prevState, responseModify);
    modifyPendingResponse(updateState, prevState, responseModify); // modify response with future changes
    return updateState;
});
}

// optimization checks if change consists only from current group object value
function isShallow(changeValue) {
    if(changeValue.constructor !== String) {
        for(const key in changeValue)
            if(!(key === "value" && changeValue.value.constructor === Array))
                return false;
        return true;
    }
    return false;
}

function copyUpdateState(updateState, prevState, changeState) {
    for (const groupObjectOrProperty in changeState) {
        let changeValue = changeState[groupObjectOrProperty];
        if (!isShallow(changeValue)) {
            let prevValue = prevState[groupObjectOrProperty];
            if (prevValue.constructor !== String) { // deep copy value to update it in modifyChange
                prevValue = {...prevValue};
                if (prevValue.list != null)
                    prevValue.list = [...prevValue.list];
            }
            updateState[groupObjectOrProperty] = prevValue;
        }
    }
}

// it should be pretty similar to modifyPendingResponse, but the flow there is a lot more complex
function updateRequest(updateState, prevState, changeState) {

    copyUpdateState(updateState, prevState, changeState);

    modifyChange(changeState, updateState, updateState, prevState);
}

function modifyChangeValue(updateObject, responseObject, changeObject, property, drop) {
    if (!isUndef(changeObject[property]) && !isUndef(responseObject[property])) {// if there was value change in next change and in response remove in response
        if(drop)
            delete updateObject[property];
        else
            updateObject[property] = changeObject[property];
    }
}

// assert updateValue is a copy so will change it right here
function modifyGroupObjectChange(responseValue, updateValue, changeValue, newDelete, createNewObject) {
    if (responseValue != null) { // we're only interested in changed state (but all changes should be made in result (update) state)
        let currentSame = true;
        let changesGroupObjectValue = changeValue.value;
        if (changesGroupObjectValue.constructor === Array) { // current (not change) value
            changesGroupObjectValue = changesGroupObjectValue[0];
            currentSame = equals(changesGroupObjectValue, updateValue.value);
        }

        // we have to proceed list first, to update value afterwards
        if (responseValue.list != null) { // grid properties
            let updateList = updateValue.list; // assert that's a copy so will change it right here
            if (newDelete != null && newDelete)
                updateList.push(createNewObject(changesGroupObjectValue)); // assert changesGroupObjectValue is not array
            let i = 0;
            for (;i<updateList.length;i++) {
                let item = updateList[i];
                if (equals(changesGroupObjectValue, item.value)) {
                    item = {...item}; // copy to modify changed props
                    for (const itemKey in item) // in theory here can be also only items in response but it isn't worth it
                        if (itemKey !== "value")
                            modifyChangeValue(item, item, changeValue, itemKey, false); // we have to change to next changed value, because for group object whole value will be replaced
                    updateList[i] = item;
                    break; // there is only one row with needed value
                }
            }
            if (newDelete != null && !newDelete) {
                if (currentSame) // if deleting current element, setting current value to nearest one
                    changeValue = i > 0 ? updateList[i - 1] : (updateList.length > 1 ? updateList[i + 1] : { value: null } ); // selecting previous, next, or null object
                updateList.splice(i, 1);  // assert changesGroupObjectValue is array
            }
        }
        for (const key in responseValue)
            if (key !== "list") { // current row values or panel property
                if (currentSame && !(key === "value" && changeValue.value.constructor === Array)) // if the row is the same + we don't want to set "current" value
                    modifyChangeValue(updateValue, responseValue, changeValue, key, false) // we have to change to next changed value, because for group object whole value will be replaced
            }
    }
}

function modifyChange(changeState, updateState, responseState, prevState) {
    for (const groupObjectOrProperty in changeState) {
        let changeValue = changeState[groupObjectOrProperty];
        if (!isShallow(changeValue)) {
            if (isGroupObject(changeValue)) { // groupobject
                let groupObject = groupObjectOrProperty;
                let newDelete = hasNewDelete(prevState, groupObject, changeValue);
                modifyGroupObjectChange(responseState[groupObject], updateState[groupObject], changeValue, newDelete, (value) => createNewObject(value, prevState, groupObject));
            } else // property withoutParams
                modifyChangeValue(updateState, responseState, changeState, groupObjectOrProperty, true); // we can drop state change in that case
        }
    }
}

function modifyPendingResponse(updateState, prevState, responseState) {
    // assert updateState.lastReceivedRequestIndex = prevState.lastRequestIndex + 1
    // so remove'ing first (this) change
    const pendingChanges = [...prevState.pendingChanges];
    pendingChanges.shift();

    for(const changeState of pendingChanges)
        modifyChange(changeState, updateState, responseState, prevState);

    updateState.pendingChanges = pendingChanges;
    return updateState;
}

function equals(a,b) {
    // if(a == null)
    //     return b == null;
    // if(b == null)
    //     return false;

    let aIsObject = a.constructor === Object;
    let bIsObject = b.constructor === Object;
    if(aIsObject !== bIsObject)
        return false;

    if(!aIsObject)
        return a === b;

    // Create arrays of property names
    const aProps = Object.getOwnPropertyNames(a);
    const bProps = Object.getOwnPropertyNames(b);

    // If number of properties is different,
    // objects are not equivalent
    if (aProps.length != bProps.length) {
        return false;
    }

    for (let i = 0; i < aProps.length; i++) {
        let propName = aProps[i];

        // If values of same property are not equal,
        // objects are not equivalent
        if (a[propName] !== b[propName]) {
            return false;
        }
    }

    // If we made it this far, objects
    // are considered equivalent
    return true;
}

function updateGroupObjectResponse(groupObject, prevState, responseValue, updateState) {
    let prevValue = {...prevState[groupObject]}; // only part of group can be changed, so we need to copy prev state
    for (const key in responseValue) {
        const responseKeyValue = responseValue[key];
        let newValue;
        if (key === 'list') { // grid properties
            let newList;
            const responseList = responseKeyValue;
            let prevList = prevValue[key];
            if (prevList != null && prevList.length >= 1 && responseList.length >= 1 && Object.keys(responseList[0]).length < Object.keys(prevList[0]).length) { // some properties changed
                newList = [];
                let iu = 0;
                for (let responseItem of responseList) {
                    let item;
                    if (iu < prevList.length && equals((item = prevList[iu]).value, responseItem.value)) { // this check is needed for async deletes
                        iu++;
                        responseItem = {...item, ...responseItem};
                    }
                    newList.push(responseItem);
                }
            } else // all keys and properties changed
                newList = responseList;
            newValue = newList;
        } else // current row values or panel property
            newValue = responseKeyValue;
        prevValue[key] = newValue;
    }
    updateState[groupObject] = prevValue;
}

function isGroupObject(value) {
    return value != null && value.constructor === Object;
}

function updateResponse(updateState, prevState, responseState) {
    // modify
    for (const groupObjectOrProperty in responseState) {
        let responseValue = responseState[groupObjectOrProperty];
        if (isGroupObject(responseValue))
            updateGroupObjectResponse(groupObjectOrProperty, prevState, responseValue, updateState);
        else  //property without params
            updateState[groupObjectOrProperty] = responseValue;
    }
}

function fetchJSONRequest(url, request, onSuccess) {
    const params = {
        method: "post",
        body: JSON.stringify(request),
        credentials: 'include'
    };
    try {
        fetch(url, params).then(response => response.json())
    .then(response => onSuccess(response));
    } catch (e) {
        console.log(e);
    }
}

function close(setState) {
    setState(prevState => {

        if(prevState.lastReceivedRequestIndex !== prevState.requestIndex) { // there are pending change requests
        postpone(() => close(setState));
        return {};
    }

    fetchJSONRequest(prevState.url, {
        action: 'close',
        form: prevState.form,
    }, response => {
    });
    return {};
});
}

function guidGenerator() {
    let S4 = function() {
        return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    };
    return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

// function sendJSONRequest(url, request) {
//
//     var xhr = new XMLHttpRequest();
//     xhr.open('POST', url, false); //open connection, synchronous
//     xhr.withCredentials = true; //to send cookie
//
//     xhr.send(JSON.stringify(request)); //send request
//
//     return JSON.parse(xhr.response);  //parse response
// }

export { create, change, close, equals, formCreated, numberOfPendingRequests };