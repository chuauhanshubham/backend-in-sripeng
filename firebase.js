// firebase.js
const { initializeApp } = require('firebase/app');
const { getDatabase } = require('firebase/database');

const firebaseConfig = {
  //   apiKey: "YOUR_API_KEY",
  //   authDomain: "your-project-id.firebaseapp.com",
  //   databaseURL: "https://cricket-score-696c4-default-rtdb.firebaseio.com",
  //   projectId: "your-project-id",
  //   storageBucket: "your-project-id.appspot.com",
  //   messagingSenderId: "your-messaging-sender-id",
  //   appId: "your-app-id"
  apiKey: "AIzaSyBtu9l-P32jKi8DA62z1bf6p7Gnebew9aQ",
  authDomain: "rudram-517df.firebaseapp.com",
  databaseURL: "https://rudram-517df-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rudram-517df",
  storageBucket: "rudram-517df.firebasestorage.app",
  messagingSenderId: "36387473272",
  appId: "1:36387473272:web:a41b6096bcc1258dabaa8d",
  measurementId: "G-K1XHTRNZ29"
  // apiKey: "AIzaSyB1IqbCgxh8hcLHuNqv8ibafz2KcplhUqE",
  // authDomain: "cricket-score-696c4.firebaseapp.com",
  // databaseURL: "https://cricket-score-696c4-default-rtdb.firebaseio.com",
  // projectId: "cricket-score-696c4",
  // storageBucket: "cricket-score-696c4.firebasestorage.app",
  // messagingSenderId: "116423704185",
  // appId: "1:116423704185:web:57e9edbf828c832e005ea8"  
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

module.exports = database;
