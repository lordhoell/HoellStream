        let ws = null;
        let eventCount = 0;

        function connect() {
            if (ws) {
                ws.close();
            }

            const statusEl = document.getElementById('statusText');
            const eventsEl = document.getElementById('events');
            const connectBtn = document.getElementById('connectBtn');

            try {
                ws = new WebSocket('ws://localhost:21213/');
                
                ws.onopen = () => {
                    statusEl.textContent = 'Connected';
                    statusEl.className = 'connected';
                    connectBtn.textContent = 'Disconnect';
                    addEvent('WebSocket connected!', 'system');
                };

                ws.onclose = () => {
                    statusEl.textContent = 'Disconnected';
                    statusEl.className = 'disconnected';
                    connectBtn.textContent = 'Connect';
                    addEvent('WebSocket disconnected', 'system');
                    ws = null;
                };

                ws.onerror = (error) => {
                    addEvent(`WebSocket error: ${error}`, 'error');
                };

                ws.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        
                        // Special handling for subscription events
                        if (data.event === 'subscribe' || data.event === 'subscription') {
                            addEvent(`========== SUBSCRIPTION EVENT #${++eventCount} ==========`, 'header');
                            addEvent(`Event Type: ${data.event}`, 'info');
                            
                            // Log all fields that might contain sender info
                            const possibleSenderFields = [
                                'senderNickname', 'senderUniqueId', 'senderProfilePictureUrl',
                                'sender_nickname', 'sender_unique_id', 'sender_profile_picture_url',
                                'gifterNickname', 'gifterUniqueId', 'gifter_nickname', 'gifter_unique_id',
                                'from_user', 'fromUser', 'gift_from', 'giftFrom'
                            ];
                            
                            addEvent('Checking for sender fields:', 'info');
                            possibleSenderFields.forEach(field => {
                                if (data.data && data.data[field]) {
                                    addEvent(`  ✓ ${field}: ${data.data[field]}`, 'success');
                                }
                            });
                            
                            // Show full event data
                            addEvent('\nFull Event Data:', 'info');
                            addEvent(JSON.stringify(data, null, 2), 'data');
                        } else {
                            // For other events, just show summary
                            addEvent(`Event: ${data.event}`, 'header');
                            addEvent(JSON.stringify(data, null, 2), 'data');
                        }
                        
                    } catch (err) {
                        addEvent(`Failed to parse message: ${e.data}`, 'error');
                    }
                };

            } catch (err) {
                addEvent(`Connection error: ${err.message}`, 'error');
            }
        }

        function addEvent(message, type = 'data') {
            const eventsEl = document.getElementById('events');
            const timestamp = new Date().toLocaleTimeString();
            
            let className = '';
            if (type === 'header') className = 'event-header';
            else if (type === 'error') className = 'error';
            else if (type === 'success') className = 'connected';
            else if (type === 'info') className = 'info';
            
            eventsEl.innerHTML += `<div class="${className}">[${timestamp}] ${message}</div>`;
            
            if (document.getElementById('autoScroll').checked) {
                eventsEl.scrollTop = eventsEl.scrollHeight;
            }
        }

        function clearEvents() {
            document.getElementById('events').innerHTML = '';
            eventCount = 0;
        }

        // Connect automatically on load
        window.onload = () => {
            connect();
        };
