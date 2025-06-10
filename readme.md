HoellStream displays TikTok, Twitch, and YouTube chats and stream events in two separate windows:

Overlay: stream events like follows, subs, bits, superchats, and more
Chat: unified chat feed from TikTok, Twitch, and YouTube

Prerequisites:
Tikfinity Desktop App installed for TikTok 
Twitch Dev Console App: Client ID and Client Secret
Google Cloud Console App: Client ID and Client Secret

Launch the app
Double-click the provided HoellStream.exe to open both Overlay and Chat windows

Edit configuration
Open the app menu and select Settings
Enter your client ID and client Secret for both Twitch and YouTube.
Click Log into Twitch
Click Log into YouTube


Reload windows
Use the "Reload" menu item to refresh both Overlay and Chat windows after saving

***-You will need to load your YouTube Stream ID each stream-***

HOW TO OBTAIN CLIENT ID AND CLIENT SECRET FROM TWITCH AND YOUTUBE

TWITCH
Go to https://dev.twitch.tv/console/apps
Click Register Your Application
    Name: HoellStream_[YourTwitchName]
    OAuth Redirect URLs: http://localhost:4391/twitch-callback
    Category: Chatbot
    Client Type: Confidential

Note down the Client ID
Save
Click New Secret
Note down the Client Secret
Save

YOUTUBE
Go to https://console.cloud.google.com/
Create a new project
Click hamburger menu > APIs & Services > Enabled API & Services
Click + Enable APIs and services
Enable YouTube Data API v3

Click hamburger menu > APIs & Services > OAuth Consent Screen
Click Data Access
Add or Remove Scopes
Add the scope .../auth/youtube.readonly
Click Update

Click hamburger menu > APIs & Services > OAuth Consent Screen
Click Clients
Click + Create Client
    Application Type: Desktop
    Name: HoellStream
Download the JSON that is provided on the next screen
Note down the Client ID and Secret

Click hamburger menu > APIs & Services > OAuth Consent Screen
Click Audience
Ensure App is in testing
Add your YouTube account email as a test user


