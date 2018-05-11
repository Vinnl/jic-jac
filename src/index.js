// Security note: the databases are placed in the `.data` directory which doesn't get copied if someone remixes the project.
  
const express = require('express')
const Sequelize = require('sequelize')
const passport = require('passport')
const session = require('express-session')
const connect = require('connect-sqlite3')
const bodyParser = require('body-parser')
const { Issuer, Strategy } = require('openid-client')
const handlebars  = require('express-handlebars')
const request = require('request')
const cheerio = require('cheerio')
const uuid = require('uuid/v4');
const fetch = require('node-fetch');
const moment = require('moment');

Issuer.defaultHttpOptions = {
  timeout: 30000,
}

const Store = connect(session)

const sequelize = new Sequelize(
  'database',
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: '0.0.0.0',
    dialect: 'sqlite',
    storage: '.data/database.sqlite',
    timeout: 30000
  })
    
function clap_to_event(clap) {
  let date_str = moment(clap.createdAt).format("YYYY-MM-DDTHH:mm:sZ");
  return {
        
      "license": "https://creativecommons.org/publicdomain/zero/1.0/",
      "obj_id": "https://doi.org/" + clap.doi,
      "source_token":  "e330ad99-b54e-4557-a81c-b9178ed7953f",
      "occurred_at": date_str,
      "subj_id": clap.orcid,
      "id": "53133861-1f04-447e-b419-05d5a6221b5c",
      "action": "add",
      "subj": {
      },
      "source_id": "plaudit",
      "obj": {
      },
      "relation_type_id": "likes",
      "relation_subtype_id": clap.type
    } 
  
}

function send_clap(clap) {
  let event = clap_to_event(clap);
  if (!clap.event_sent) {
    let serialized = JSON.stringify(event);
    
    fetch(process.env.EVENT_DATA_ENDPOINT,
          { method: 'POST',
            body: serialized,
           headers: {"Content-Type": "application/json",
                     "Authorization": "Bearer " + process.env.EVENT_DATA_TOKEN}})
    .then((response) => {      
      clap.event_sent = true;
      console.log("Sent Clap to Crossref, ID", "http://bus-staging.eventdata.crossref.org/events/" + clap.event_id);
      console.log(response);
      clap.save().then(() => {
        
      })
    });
  }
}

const run = async () => {
  await sequelize.authenticate()

  const Clap = sequelize.define('claps', {
    orcid: {
      type: Sequelize.STRING,
    },
    doi: {
      type: Sequelize.STRING,
    },
    type: {
      type: Sequelize.STRING,
    },
    event_id: {
     type:  Sequelize.STRING
    },
    event_sent: {
      type: Sequelize.BOOLEAN
    }
  })
  
  const User = sequelize.define('users', {
    orcid: {
      type: Sequelize.STRING,
      primaryKey: true
    },
    name: {
      type: Sequelize.STRING,
    }
  })
  
  User.hasMany(Clap, {
    foreignKey: 'orcid'
  })
  
  Clap.belongsTo(User, {
    foreignKey: 'orcid',
    onDelete: 'cascade',
  })
  
  const include = [{
    model: User,
    attributes: ['orcid', 'name']
  }] 

  await sequelize.sync({ 
    force: true // uncomment this to drop the tables
  })

  passport.serializeUser((user, done) => {    
    done(null, user.orcid)
  })

  passport.deserializeUser(async (orcid, done) => {
    const user = await User.findById(orcid)
    done(null, user)
  })

  const issuer = await Issuer.discover('https://orcid.org/')

  passport.use(
    'orcid',
    new Strategy(
      {
        client: new issuer.Client({
          client_id: process.env.ORCID_CLIENT_ID,
          client_secret: process.env.ORCID_CLIENT_SECRET,
        }),
        params: {
          redirect_uri: 'https://plaudit.glitch.me/orcid/callback',
          scope: 'openid',
        },
      },
      async (tokenset, done) => {
        console.log(tokenset.claims)
        const { sub: orcid, name, family_name, given_name } = tokenset.claims
        
        const user = { 
          orcid, 
          name: name || [given_name, family_name].join(' ').trim() 
        }
        
        await User.upsert(user)
        
        done(null, user)
      }
    )
  )

  express()
    .engine('handlebars', handlebars())
    .set('view engine', 'handlebars')
    .use(express.static('public'))
    .use(
      session({
        store: new Store({
          dir: '.data',
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
          maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
          // secure: true,
          // httpOnly: true,
        },
      })
    )
    .use(passport.initialize())
    .use(passport.session())
    .get('/', (req, res) => {
      res.render('home')
    })
    .get('/widget', async (req, res) => {
      const { doi } = req.query

      if (!doi) res.sendStatus(400)
    
      const orcid = req.user && req.user.orcid

      res.render('widget', { 
        doi: req.query.doi,
        clapped: orcid ? await Clap.count({ where: { doi, orcid } }) : 0,
        claps: await Clap.findAll({ where: { doi }, include }),
      })
    })
    .get('/orcid', passport.authenticate('orcid'))
    .get('/orcid/callback', passport.authenticate('orcid'), (req, res) => {
      res.render('authenticated', {
        orcid: req.user.orcid,
      })
    })
    .get('/claps', async (req, res) => {
      const { doi, orcid } = req.query;
      
      let claps = await Clap.findAll();
    
      if (orcid) {
        res.send({
          claps: await Clap.findAll({ where: { orcid } })
        })
      } else if (doi) {
        res.send({
          claps: await Clap.findAll({ where: { doi }, include })
        })
      } else {
        res.send({
          claps: await Clap.findAll({ include })
        })
      }
    })
    .post('/claps', bodyParser.json(), async (req, res) => {
      if (!req.user) return res.sendStatus(403)
      const { orcid } = req.user

      const { doi, type } = req.body
      const event_id = uuid();
    
      if (!doi) return res.sendStatus(400)

      const clap = await Clap.create({ doi, orcid, type, event_id })
      
      
      send_clap(clap);

      res.sendStatus(200)
    })
    .get('/biorxiv/content/*', (req, res) => {
      const url = 'https://www.biorxiv.org/content/' + req.params['0']
      
      request(url, (error, response, html) => {
        if (error || response.statusCode !== 200) {
          res.sendStatus(500)
        }
        
        const $ = cheerio.load(html)
        
        $('head').append(`<base href="${url}">`)
        
        const doi = $('meta[name="citation_doi"]').attr('content')
        
        $('#mini-panel-biorxiv_art_tools').append(`<iframe src="https://plaudit.glitch.me/widget?doi=${encodeURIComponent(doi)}">clap</iframe>`)
        
        res.send($.html())
      })
    })
    .listen(process.env.PORT, () => {
      console.log('ready')
    })
}

run().catch(err => {
  console.log('error!', err)
})
