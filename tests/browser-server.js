import {createApp} from '../server/app.js';
const {app}=createApp(':memory:');
app.listen(5173,'127.0.0.1');
