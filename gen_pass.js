const bcrypt = require('bcrypt');
const password = '123';
const saltRounds = 10; // You can adjust the salt rounds as needed

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log('Hashed password:', hash);
});