(function (global) {
    function reconcileOperations(operations, remoteActivities, timestamp) {
        const remoteById = new Map((Array.isArray(remoteActivities) ? remoteActivities : []).map(activity => [String(activity?.id || ''), activity]));
        return (Array.isArray(operations) ? operations : []).reduce((remaining, operation) => {
            const remote = remoteById.get(String(operation?.activityId || ''));
            if (!remote) {
                remaining.push(operation);
                return remaining;
            }
            const payload = operation.payload || {};
            const confirmed = remote.status === payload.status && remote.alarmeStatus === payload.alarmeStatus;
            const superseded = payload.expectedStatus && remote.status !== payload.expectedStatus && remote.status !== payload.status;
            const existingCreation = !payload.expectedStatus && Number(remote.revisao || 0) > 0;
            if (confirmed || superseded || existingCreation) return remaining;

            const remoteTime = new Date(remote.atualizadoEm || 0).getTime();
            const payloadTime = new Date(payload.atualizadoEm || 0).getTime();
            if (payload.expectedStatus && remote.status === payload.expectedStatus && remoteTime >= payloadTime) {
                remaining.push({
                    ...operation,
                    payload: { ...payload, atualizadoEm:timestamp || new Date().toISOString() },
                    createdAt:Date.now()
                });
                return remaining;
            }
            remaining.push(operation);
            return remaining;
        }, []);
    }

    global.AloChecklistSync = Object.freeze({ reconcileOperations });
})(window);
