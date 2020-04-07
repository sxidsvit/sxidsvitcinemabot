
process.env.NTBA_FIX_319 = 1;

const TelegramBot = require('node-telegram-bot-api')
const mongoose = require('mongoose')
const geolib = require('geolib')
const _ = require('lodash')
const config = require('./config')
const helper = require('./helper')
const kb = require('./keyboard-buttons')
const keyboard = require('./keyboard')

helper.logStart() // видим в консоли перезапуск скрипта
// подключение к БД (https://habr.com/ru/post/342560/)
mongoose.connect(config.DB_URL_ATLAS, {
  useUnifiedTopology: true,
  useNewUrlParser: true
}).then(() => console.log('MongoDB connected'))
  .catch((err) => console.log(err))

//  вставляем код создающий схемы FilmSchema,CinemaSchema, UserSchema и преобразующих в модели Film и Cinema, User
require('./model/film.model')
require('./model/cinema.model')
require('./model/user.model')

// получаем модели Film, Cinema User, для дальнейшей работы с ними
const Film = mongoose.model('films')
const Cinema = mongoose.model('cinemas')
const User = mongoose.model('users')

//  Переписываем.сохраняем данные из локального файла в базу MongoDB . Это ОДНОРАЗОВАЯ операция !!!

// const database = require('../database.json')
// database.films.forEach(f => {
//   new Film(f).save().catch(e => console.log(e))
// })
// const database2 = require('../database.json')
// database2.cinemas.forEach(c => {
//   new Cinema(c).save().catch(e => console.log(e))
// })

// из-за ограничений на размер поля callback_data создаем объект который в дальнейшем позволит выбрать нужный обработчик события callback_query
const ACTION_TYPE = {
  TOGGLE_FAV_FILM: 'tff',
  SHOW_CINEMAS: 'sc',
  SHOW_CINEMAS_MAP: 'scm',
  SHOW_FILMS: 'sf'
}

//  *** ====== логика нашего бота  ================= ***

// создаём конкретную реализацию api, отправив в конструктор полученный от телеграмма токен
const bot = new TelegramBot(config.TOKEN, {
  polling: true
});
// теперь у нас есть объект на который мы можем навешивать наши обработчики событий

// создаем обработчик ошибок, который в консоль будет выводить  детали ошибок обращения бота к API telegram

bot.on("polling_error", (err) => console.log(err))

//  обработчик сообщений полученных от бота
bot.on('message', msg => {

  const chatId = helper.getChatId(msg)

  switch (msg.text) {
    case kb.home.favourite:
      showFavouriteFilms(chatId, msg.from.id)
      break
    case kb.home.films:
      bot.sendMessage(chatId, 'Выбирите жанр:', {
        reply_markup: { keyboard: keyboard.films }
      })
      break
    case kb.home.cinemas:
      bot.sendMessage(chatId, 'Отправьте ваше местоположение', {
        reply_markup: {
          keyboard: keyboard.cinemas
        }
      })
      break
    case kb.films.comedy:
      sendFilmsByQuery(chatId, { type: 'comedy' })
      break
    case kb.films.action:
      sendFilmsByQuery(chatId, { type: 'action' })
      break
    case kb.films.random:
      sendFilmsByQuery(chatId, {})
      break
    case kb.back:
      bot.sendMessage(chatId, 'Что хотите посмотреть?', {
        reply_markup: { keyboard: keyboard.home }
      })
      break
  }

  if (msg.location) {
    // выводим список кинотеатров с расстояниями до них
    getCinemasInCoord(chatId, msg.location)
  }

})

bot.on('callback_query', query => {
  const userId = query.from.id
  try {
    data = JSON.parse(query.data)
  } catch (e) {
    throw new Error('Data is not an object')
  }

  const { type } = data

  if (type === ACTION_TYPE.SHOW_CINEMAS_MAP) {
    const { lat, lon } = data
    bot.sendLocation(query.message.chat.id, lat, lon)

  } else if (type === ACTION_TYPE.SHOW_CINEMAS) {
    sendCinemasByQuery(userId, { uuid: { '$in': data.cinemaUuids } })
  } else if (type === ACTION_TYPE.TOGGLE_FAV_FILM) {
    toggleFavouriteFilm(userId, query.id, data)
  } else if (type === ACTION_TYPE.SHOW_FILMS) {
    sendFilmsByQuery(userId, { uuid: { '$in': data.filmUuids } })
  }
})

bot.on('inline_query', query => {
  Film.find({}).then(films => {
    const results = films.map(f => {
      const caption = `Название: ${f.name}\nГод: ${f.year}\nРейтинг: ${f.rate}\nДлительность: ${f.length}\nСтрана: ${f.country}`
      return {
        id: f.uuid,
        type: 'photo',
        photo_url: f.picture,
        thumb_url: f.picture,
        caption: caption,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `Кинопоиск: ${f.name}`,
                url: f.link
              }
            ]
          ]
        }
      }
    })

    bot.answerInlineQuery(query.id, results, {
      cache_time: 0
    })
  })
})

bot.onText(/\/start/, msg => {
  const text = `Здавствуйте, ${msg.from.first_name}\nВыбирите команду для начала работы:`

  const chatId = helper.getChatId(msg)

  bot.sendMessage(chatId, text, {
    reply_markup: {
      keyboard: keyboard.home
    }
  })
})

// bot.onText(new RegExp('\/f(.+)'), (msg, [source, match]) => {
bot.onText(new RegExp('\/f(.+)'), (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message
  const filmUuid = helper.getItemUuid(match[0])
  const chatId = helper.getChatId(msg)

  Promise.all([
    Film.findOne({ uuid: filmUuid }),
    User.findOne({ telegramId: msg.from.id })
  ]).then(([film, user]) => {

    let isFav = false

    if (user) {
      isFav = user.films.indexOf(film.uuid) !== -1
    }

    const favText = isFav ? 'Удалить из избранного' : 'Добавить в избранное'

    const caption = `Название: ${film.name}\nГод: ${film.year}\nРейтинг: ${film.rate}\nДлительность: ${film.length}\nСтрана: ${film.country}`


    bot.sendPhoto(chatId, film.picture, {
      caption: caption,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: favText,
              callback_data: JSON.stringify({
                type: ACTION_TYPE.TOGGLE_FAV_FILM,
                filmUuid: film.uuid,
                isFav: isFav
              })
            },
            {
              text: 'Показать кинотеатры',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_CINEMAS,
                cinemaUuids: film.cinemas
              })
            }
          ],
          [
            {
              text: `Кинопоиск ${film.name}`,
              url: film.link
            }
          ]

        ]
      }
    })
  })

})

bot.onText(new RegExp('\/c(.+)'), (msg, [source, match]) => {
  const cinemaUuid = helper.getItemUuid(source)
  const chatId = helper.getChatId(msg)

  Cinema.findOne({ uuid: cinemaUuid }).then(cinema => {

    bot.sendMessage(chatId, `Кинотеатр ${cinema.name}`, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: cinema.name + ' (онлайн)',
              url: cinema.url
            },
            {
              text: 'Показать на карте',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_CINEMAS_MAP,
                lat: cinema.location.latitude,
                lon: cinema.location.longitude
              })
            }
          ],
          [
            {
              text: 'Показать фильмы',
              callback_data: JSON.stringify({
                type: ACTION_TYPE.SHOW_FILMS,
                filmUuids: cinema.films
              })
            }
          ]
        ]
      }
    })
  })
})


//  ======== вспомогательные функци =================
// const sendFilsByQuery = (chatId, query) => {
//   Film.find(query).then(films => {
//     console.log(films)
//   })

const sendFilmsByQuery = (chatId, query) => {
  Film.find(query).then(films => {
    const html = films.map((f, i) => {
      return `<b>${i + 1}</b> ${f.name} - /f${f.uuid}`
    }).join('\n')

    sendHTML(chatId, html, 'films')
  })
}

const sendHTML = (chatId, html, kbName = null) => {
  const options = {
    parse_mode: 'HTML'
  }

  if (kbName) {
    options['reply_markup'] = {
      keyboard: keyboard[kbName]
    }
  }

  bot.sendMessage(chatId, html, options)
}

const getCinemasInCoord = (chatId, location) => {
  Cinema.find({}).then(cinemas => {
    cinemas.forEach(c => {
      c.distance = geolib.getDistance(location, c.location) / 1000
    })

    cinemas = _.sortBy(cinemas, 'distance')

    const html = cinemas.map((c, i) => {
      return `<b>${i + 1}</b> Кинотеатр ${c.name}. <em>Расстояние</em> - <strong>${c.distance}</strong>км  /c${c.uuid}`
    }).join('\n')

    sendHTML(chatId, html, 'home')
  })
}

const toggleFavouriteFilm = (userId, queryId, { filmUuid, isFav }) => {

  let userPromise

  User.findOne({ telegramId: userId })
    .then(user => {
      if (user) {
        if (isFav) {
          user.films = user.films.filter(fUuid => fUuid !== filmUuid)
        } else {
          user.films = user.films.filter(fUuid => fUuid !== filmUuid)
          user.films.push(filmUuid)
        }
        userPromise = user
      } else {
        userPromise = new User({
          telegramId: userId,
          films: [filmUuid]
        })
      }

      const answerText = isFav ? 'Удалено' : 'Добавлено'

      userPromise.save().then(_ => {
        bot.answerCallbackQuery(queryId, {
          text: answerText
        })
      }).catch(err => console.log(err))
    }).catch(err => console.log(err))
}

const showFavouriteFilms = (chatId, telegramId) => {

  User.findOne({ telegramId: telegramId }).then(user => {
    if (user) {
      Film.find({ uuid: { '$in': user.films } }).then(
        films => {
          let html
          if (films.length) {
            html = films.map((f, i) => {
              return `<b>${i + 1}</b> ${f.name} - Рейтинг:<b>${f.rate}</b> (/f${f.uuid})`
            }).join('\n')
          } else {
            html = 'Вы пока ничего не добавили в Избранное'
          }

          sendHTML(chatId, html, 'home')
        }
      ).catch(e => console.log(e))
    } else {
      sendHTML(chatId, 'Вы пока ничего не добавили в Избранное', 'home')
    }
  }).catch(e => console.log(e))
}

const sendCinemasByQuery = (userId, query) => {

  Cinema.find(query).then(cinemas => {
    const html = cinemas.map((c, i) => {
      return `<b>${i + 1}</b> ${c.name} - /c${c.uuid}`
    }).join('\n')

    sendHTML(userId, html, 'home')
  }
  ).catch(e => console.log(e))


}