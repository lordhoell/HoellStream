HoellStream

========================================
Unified overlay and chat app for streamers

HoellStream displays TikTok, Twitch, and YouTube chats and stream events in two separate windows:

Overlay: stream events like follows, subs, bits, superchats, and more
Chat: unified chat feed from TikTok, Twitch, and YouTube

========================================
Getting Started

Launch the app
Double-click the provided HoellStream.exe to open both Overlay and Chat windows

You must have the Tikfinity Desktop app installed. By default, this setting is ON, but ensure the Event API at the bottom is working to ws://localhost:21213/

Edit configuration
Open the app menu and select "Edit Config"
A settings window will appear with fields for credentials and IDs
Hover over each ? icon for instructions on how to obtain that value
Enter your Twitch and YouTube values, then click "Save Config"

Reload windows
Use the "Reload" menu item to refresh both Overlay and Chat windows after saving

Start YouTube polling
In both Overlay and Chat windows, click "Start YouTube" to begin YouTube chat and stats polling
YouTube's API limits calls per minute, so use "Start" and "Stop" to avoid exceeding your quota

Stream-to-stream changes
After initial setup, your credentials remain valid until they expire. For each new stream, you only need to:
Open "Edit Config" from the menu
Update the YouTube Stream ID
Click "Save Config"

========================================
Tips and Notes

Tooltips explain how to obtain each credential or ID
You can toggle developer tools from the menu if you need to troubleshoot
Windows reload automatically after saving the config

