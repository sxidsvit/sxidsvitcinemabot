const kb = require('./keyboard-buttons')

// *** клавиатуры ***

// request_location - the user's current location will be sent when the button is pressed

module.exports = {
  home: [
    [kb.home.films, kb.home.cinemas],
    [kb.home.favourite]
  ],
  films: [
    [kb.films.random],
    [kb.films.action, kb.films.comedy],
    [kb.back]
  ],
  cinemas: [
    [
      {
        text: 'Отправить местоположение',
        request_location: true
      }
    ],
    [kb.back]
  ]
}