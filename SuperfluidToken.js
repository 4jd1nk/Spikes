let currentTime = parseInt(Date.now()/1000); // current unix time in seconds
const MAX_VALUE = Number.MAX_VALUE;

class SuperfluidToken {

    accounts = {};
    cfaAgreements = {}

    _getAccount(owner) {
        let acc = this.accounts[owner];
        if (!acc) {
            this.accounts[owner] = acc = {
                settledBalance: 0,
                settledTime: currentTime,
                netFlowRate: 0,
                criticalTime: MAX_VALUE,
                netFlowChanges: [],
                flowReceivers: []
            }
        }
        return acc;
    }

    balanceOf(owner) {
        const acc = this.accounts[owner];
        if (!acc) return 0;

        let balance = acc.settledBalance;
        let startTime = acc.settledTime;
        let netFlowRate = acc.netFlowRate;

        let i = 0;
        let event = acc.netFlowChanges[i];

        while(event && event.time < currentTime) {
            balance+=this.realTimeBalance(startTime, event.time, netFlowRate); 
            startTime = event.time;
            netFlowRate -= this.cfaAgreements[event.flowId].flowRate;

            i++;
            event = acc.netFlowChanges[i];
        }
        balance += this.realTimeBalance(startTime, currentTime, netFlowRate); 

        if (balance < 0)
            return 0;
        else
            return balance;     
    }

    realTimeBalance(startTime, endTime, netFlowRate) {
        return (endTime - startTime) * netFlowRate;
    }

    mint(owner, amount) {
        const acc = this._getAccount(owner);
        acc.settledBalance += amount;

        this._updateReceiverNetFlowChanges(owner);
    }

    transfer(sender, receiver, amount) {
        const senderAcc = this._getAccount(sender);
        const receiverAcc = this._getAccount(receiver);
        if (this.balanceOf(sender) < amount) throw new Error("Not enough balance");
        senderAcc.settledBalance -= amount;
        receiverAcc.settledBalance += amount;

        this._updateReceiverNetFlowChanges(sender);
        this._updateReceiverNetFlowChanges(receiver);
    }

    updateFlow(sender, receiver, flowRate) {
        const senderAcc = this._getAccount(sender);
        const receiverAcc = this._getAccount(receiver);
        const flowId = sender + ":" + receiver;
        const flow = this.cfaAgreements[flowId];
        let oldFlowRate = 0;
        if (flow) {
            oldFlowRate = flow.flowRate;
            flow.updatedAt = currentTime;
            flow.flowRate = flowRate;
        } else {
            this.cfaAgreements[flowId] = {
                createdAt: currentTime,
                updatedAt: currentTime,
                flowRate
            }
        }
        [senderAcc, receiverAcc].map(acc => {
            acc.settledBalance += (currentTime - acc.settledTime) * acc.netFlowRate;
            acc.settledTime = currentTime;
        });
        senderAcc.netFlowRate -= (flowRate - oldFlowRate);
        receiverAcc.netFlowRate += (flowRate - oldFlowRate);

        const receiverIndex = senderAcc.flowReceivers.indexOf(receiver);
        if (flowRate != 0 && receiverIndex == -1) //add receiver to list
            senderAcc.flowReceivers.push(receiver);

        this._updateReceiverNetFlowChanges(sender);
        
        if (flowRate == 0 && receiverIndex != -1) //remove receiver from list
            senderAcc.flowReceivers.slice(receiverIndex, 1); 
    }

    _updateReceiverNetFlowChanges(sender) {
        const senderAcc = this._getAccount(sender);  
        const criticalTime = this._getCriticalTime(sender);
        if (senderAcc.criticalTime == criticalTime)
            return;

        senderAcc.criticalTime = criticalTime;

        for (let i = 0; i < senderAcc.flowReceivers.length; i++) {
            let receiverAcc = this._getAccount(senderAcc.flowReceivers[i]);
            let flowId = sender + ":" + senderAcc.flowReceivers[i];
            let flow = this.cfaAgreements[flowId];

            let currentIndex = receiverAcc.netFlowChanges.findIndex(event => event.flowId == flowId); 

            //if-elsif-elsif could be refactored
            if (currentIndex == -1 && flow.flowRate != 0) { //insert
                currentIndex = 0;
                while(receiverAcc.netFlowChanges[currentIndex] && receiverAcc.netFlowChanges[currentIndex].time < senderAcc.criticalTime) {
                    currentIndex++;
                }

                receiverAcc.netFlowChanges.splice(currentIndex, 0, {
                    flowId : flowId,
                    time: senderAcc.criticalTime
                });
            }
            else if (currentIndex != -1 && flow.flowRate != 0) { //update
                let newIndex = 0;
                while(receiverAcc.netFlowChanges[newIndex] && receiverAcc.netFlowChanges[newIndex].time < senderAcc.criticalTime) {
                    newIndex++;
                }

                if (currentIndex != newIndex) {
                    receiverAcc.netFlowChanges.splice(newIndex, 0, {
                        flowId : flowId,
                        time: senderAcc.criticalTime
                    });
                    receiverAcc.netFlowChanges.splice(currentIndex, 1);
                }
            }   
            else if (currentIndex != -1 && flow.flowRate == 0) { //delete
                receiverAcc.netFlowChanges.splice(currentIndex, 1);
            }

            this._updateReceiverNetFlowChanges(senderAcc.flowReceivers[i]);
        }
    }

    _getCriticalTime(owner) {
        const ownerAcc = this._getAccount(owner);

        let netFlowRate = ownerAcc.netFlowRate;
        let totalBalance = ownerAcc.settledBalance;
        let lastSettledTime = ownerAcc.settledTime;

        let criticalTime = netFlowRate < 0 ? lastSettledTime - (totalBalance / netFlowRate) : MAX_VALUE;

        for (let i = 0; i < ownerAcc.netFlowChanges.length; i++) {
            if (ownerAcc.netFlowChanges[i].time > criticalTime)
                break;

            totalBalance += (ownerAcc.netFlowChanges[i].time - lastSettledTime) * netFlowRate;
            lastSettledTime = ownerAcc.netFlowChanges[i].time;

            let flow = this.cfaAgreements[ownerAcc.netFlowChanges[i].flowId];
            netFlowRate-=flow.flowRate;

            criticalTime = netFlowRate < 0 ? lastSettledTime - (totalBalance / netFlowRate) : MAX_VALUE;            
        }
        return criticalTime;
    }
}



// Tests

function printAccount(token, owner) {
    console.log(`${owner} balanceOf:${token.balanceOf(owner)}`);
}

const token = new SuperfluidToken();

console.log("# mint to bob $100");
printAccount(token, "bob");
token.mint("bob", 100);
printAccount(token, "bob");
console.log("# transfer $10 from bob to alice");
token.transfer("bob", "alice", 10);
printAccount(token, "bob");
printAccount(token, "alice");
console.log("# transfer $100.1 from bob should fail");
try { token.transfer("bob", "alice", 100.1) } catch (err) { console.log("Caught:", err.message); };
console.log("# create flow from bob to alice at $10/hour");
token.updateFlow("bob", "alice", 10/3600);
printAccount(token, "bob");
printAccount(token, "alice");
console.log("# advancing for 2 hours...");
currentTime += 3600 *2;
printAccount(token, "bob");
printAccount(token, "alice");
console.log("# create flow from alice to carol at $5/hour");
token.updateFlow("alice", "carol", 5/3600);
printAccount(token, "bob");
printAccount(token, "alice");
printAccount(token, "carol");
console.log("# advancing for 2 hours...");
currentTime += 3600 *2;
printAccount(token, "bob");
printAccount(token, "alice");
printAccount(token, "carol");
