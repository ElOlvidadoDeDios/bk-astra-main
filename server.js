require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
const path = require('path');

// Cloudinary con credenciales
cloudinary.config({ 
  cloud_name: 'dd0qlzyyk', 
  api_key: '952839112726724', 
  api_secret: '7fxZGsz7Lz2vY5Ahp6spldgMTW4' 
});

// Crear el directorio de uploads si no existe
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Modifica la configuración de multer para mayor control
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const app = express();

//app.use(cors({ origin: true, credentials: true }));
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(bodyParser.json());

// Configuración de la base de datos
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};
(async () => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Conexión exitosa a la base de datos');
    await connection.end();
  } catch (err) {
    console.error('Error al conectar a la base de datos:', err.message);
  }
})();

const pool = mysql.createPool(dbConfig);

// Middleware para manejar errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Algo salió mal!' });
});

// Nueva ruta para subir imágenes
// Ruta de upload para manejar tanto imágenes como videos
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    // Verificar tamaño del archivo (50MB máximo)
    if (req.file.size > 50 * 1024 * 1024) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'El archivo es demasiado grande (máximo 50MB)' });
    }

    const isVideo = req.file.mimetype.startsWith('video/');
    const resourceType = isVideo ? 'video' : 'image';
    const folder = isVideo ? 'astravon/videos' : 'astravon/images';

    // Si es video, obtener duración
    let duration = null;
    if (isVideo) {
      const getDuration = require('get-audio-duration');
      const durationInSeconds = await getDuration.getAudioDurationInSeconds(req.file.path);
      const minutes = Math.floor(durationInSeconds / 60);
      const seconds = Math.floor(durationInSeconds % 60);
      duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    const uploadOptions = {
      resource_type: resourceType,
      folder: folder,
      ...(isVideo && {
        eager: [{ width: 800, height: 600, crop: "limit" }],
        eager_async: true
      })
    };

    const result = await cloudinary.uploader.upload(req.file.path, uploadOptions);
    fs.unlinkSync(req.file.path); // Eliminar archivo temporal

    res.json({ 
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: resourceType,
      duration: duration
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error en la subida:', err);
    res.status(500).json({ 
      error: 'Error al procesar el archivo',
      details: err.message 
    });
  }
});

// Rutas para Escuelas
app.get('/api/schools', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, description, imageUrl, tema FROM School ORDER BY Id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schools', async (req, res) => {
  try {
    const { name, description, imageUrl, tema } = req.body;
    const [result] = await pool.query(
      'INSERT INTO School (Name, Description, ImageUrl, Tema) VALUES (?, ?, ?, ?)',
      [name, description, imageUrl, tema]
    );
    const [newSchool] = await pool.query('SELECT * FROM School WHERE Id = ?', [result.insertId]);
    res.status(201).json(newSchool[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/schools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, imageUrl, tema } = req.body;
    await pool.query(
      'UPDATE School SET Name = ?, Description = ?, ImageUrl = ?, Tema = ? WHERE Id = ?',
      [name, description, imageUrl, tema, id]
    );
    const [updatedSchool] = await pool.query('SELECT * FROM School WHERE Id = ?', [id]);
    res.json(updatedSchool[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schools/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM School WHERE Id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas para Módulos
app.get('/api/modules', async (req, res) => {
  try {
    const { schoolId } = req.query;
    let query = `
      SELECT 
        Module.Id AS id,
        Module.Name AS name,
        Module.Description AS description,
        Module.Level AS level,
        Module.\`Order\` AS \`order\`,
        Module.SchoolId AS schoolId,
        School.Name AS schoolName
      FROM Module
      LEFT JOIN School ON Module.SchoolId = School.Id
    `;

    if (schoolId) {
      query += ' WHERE Module.SchoolId = ?';
    }

    query += ' ORDER BY Module.\`Order\`';

    const [rows] = schoolId 
      ? await pool.query(query, [schoolId])
      : await pool.query(query);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/modules', async (req, res) => {
  try {
    const { schoolId, name, description, level, order } = req.body;
    const [result] = await pool.query(
      'INSERT INTO Module (SchoolId, Name, Description, Level, `Order`) VALUES (?, ?, ?, ?, ?)',
      [schoolId, name, description, level, order]
    );
    const [newModule] = await pool.query('SELECT * FROM Module WHERE Id = ?', [result.insertId]);
    res.status(201).json(newModule[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/modules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, name, description, level, order } = req.body;
    await pool.query(
      'UPDATE Module SET SchoolId = ?, Name = ?, Description = ?, Level = ?, `Order` = ? WHERE Id = ?',
      [schoolId, name, description, level, order, id]
    );
    const [updatedModule] = await pool.query('SELECT * FROM Module WHERE Id = ?', [id]);
    res.json(updatedModule[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/modules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM Module WHERE Id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas para Cursos
app.get('/api/courses', async (req, res) => {
  try {
    const { moduleId } = req.query;
    let query = `
      SELECT 
        c.Id AS id,
        c.ModuleId AS moduleId,
        c.Title AS title,
        c.Description AS description,
        c.ImageUrl AS imageUrl,
        c.VideoUrl AS videoUrl,
        c.Duration AS duration,
        c.\`Order\` AS \`order\`,
        m.Name AS moduleName
      FROM Course c
      LEFT JOIN Module m ON c.ModuleId = m.Id
    `;

    if (moduleId) {
      query += ' WHERE c.ModuleId = ?';
    }

    query += ' ORDER BY c.\`Order\`';

    const [rows] = moduleId 
      ? await pool.query(query, [moduleId])
      : await pool.query(query);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/courses', async (req, res) => {
  try {
    const { moduleId, title, description, imageUrl, videoUrl, duration, order } = req.body;
    const [result] = await pool.query(
      'INSERT INTO Course (ModuleId, Title, Description, ImageUrl, VideoUrl, Duration, `Order`) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [moduleId, title, description, imageUrl, videoUrl, duration, order]
    );
    const [newCourse] = await pool.query('SELECT * FROM Course WHERE Id = ?', [result.insertId]);
    res.status(201).json(newCourse[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT 
        c.Id AS id,
        c.ModuleId AS moduleId,
        c.Title AS title,
        c.Description AS description,
        c.ImageUrl AS imageUrl,
        c.VideoUrl AS videoUrl,
        c.Duration AS duration,
        c.\`Order\` AS \`order\`,
        m.Name AS moduleName
      FROM Course c
      LEFT JOIN Module m ON c.ModuleId = m.Id
      WHERE c.Id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { moduleId, title, description, imageUrl, videoUrl, duration, order } = req.body;
    await pool.query(
      'UPDATE Course SET ModuleId = ?, Title = ?, Description = ?, ImageUrl = ?, VideoUrl = ?, Duration = ?, `Order` = ? WHERE Id = ?',
      [moduleId, title, description, imageUrl, videoUrl, duration, order, id]
    );
    const [updatedCourse] = await pool.query('SELECT * FROM Course WHERE Id = ?', [id]);
    res.json(updatedCourse[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM Course WHERE Id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas para Secciones
app.get('/api/sections', async (req, res) => {
  try {
    const { courseId } = req.query;
    let query = `
      SELECT 
        s.Id AS id,
        s.CourseId AS courseId,
        s.ResourceName AS resourceName,
        s.Instructions AS instructions,
        s.ExternalUrl AS externalUrl,
        s.\`Order\` AS \`order\`,
        c.Title AS courseTitle
      FROM Section s
      LEFT JOIN Course c ON s.CourseId = c.Id
    `;

    if (courseId) {
      query += ' WHERE s.CourseId = ?';
    }

    query += ' ORDER BY s.\`Order\`';

    const [rows] = courseId 
      ? await pool.query(query, [courseId])
      : await pool.query(query);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sections', async (req, res) => {
  try {
    const { courseId, resourceName, instructions, externalUrl, order } = req.body;
    const [result] = await pool.query(
      'INSERT INTO Section (CourseId, ResourceName, Instructions, ExternalUrl, `Order`) VALUES (?, ?, ?, ?, ?)',
      [courseId, resourceName, instructions, externalUrl, order]
    );
    const [newSection] = await pool.query('SELECT * FROM Section WHERE Id = ?', [result.insertId]);
    res.status(201).json(newSection[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { courseId, resourceName, instructions, externalUrl, order } = req.body;
    await pool.query(
      'UPDATE Section SET CourseId = ?, ResourceName = ?, Instructions = ?, ExternalUrl = ?, `Order` = ? WHERE Id = ?',
      [courseId, resourceName, instructions, externalUrl, order, id]
    );
    const [updatedSection] = await pool.query('SELECT * FROM Section WHERE Id = ?', [id]);
    res.json(updatedSection[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM Section WHERE Id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas para Podcasts
app.get('/api/podcasts/episodes', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM PodcastEpisodes ORDER BY episode_number');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/podcasts/programs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM PodcastPrograms ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/podcasts/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [program] = await pool.query('SELECT * FROM PodcastPrograms WHERE id = ?', [id]);

    if (program.length === 0) {
      return res.status(404).json({ error: 'Programa no encontrado' });
    }

    const [episodes] = await pool.query('SELECT * FROM PodcastEpisodes WHERE program_id = ? ORDER BY episode_number', [id]);

    res.json({
      ...program[0],
      episodes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/podcasts/programs', async (req, res) => {
  try {
    const { title, description, image_url, category } = req.body;
    const [result] = await pool.query(
      'INSERT INTO PodcastPrograms (title, description, image_url, category) VALUES (?, ?, ?, ?)',
      [title, description, image_url, category]
    );

    const [newProgram] = await pool.query('SELECT * FROM PodcastPrograms WHERE id = ?', [result.insertId]);
    res.status(201).json(newProgram[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/podcasts/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, image_url, category } = req.body;

    await pool.query(
      'UPDATE PodcastPrograms SET title = ?, description = ?, image_url = ?, category = ? WHERE id = ?',
      [title, description, image_url, category, id]
    );

    const [updatedProgram] = await pool.query('SELECT * FROM PodcastPrograms WHERE id = ?', [id]);
    res.json(updatedProgram[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/podcasts/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM PodcastPrograms WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rutas para Episodios
app.post('/api/podcasts/episodes', async (req, res) => {
  try {
    const { program_id, title, description, audio_url, duration, episode_number, publish_date } = req.body;
    const [result] = await pool.query(
      'INSERT INTO PodcastEpisodes (program_id, title, description, audio_url, duration, episode_number, publish_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [program_id, title, description, audio_url, duration, episode_number, publish_date]
    );

    const [newEpisode] = await pool.query('SELECT * FROM PodcastEpisodes WHERE id = ?', [result.insertId]);
    res.status(201).json(newEpisode[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/podcasts/episodes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, audio_url, duration, episode_number, publish_date } = req.body;

    await pool.query(
      'UPDATE PodcastEpisodes SET title = ?, description = ?, audio_url = ?, duration = ?, episode_number = ?, publish_date = ? WHERE id = ?',
      [title, description, audio_url, duration, episode_number, publish_date, id]
    );

    const [updatedEpisode] = await pool.query('SELECT * FROM PodcastEpisodes WHERE id = ?', [id]);
    res.json(updatedEpisode[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/podcasts/episodes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM PodcastEpisodes WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ruta para subir audios (similar a la de imágenes pero para audio)
app.post('/api/upload-audio', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    // Obtener duración del audio
    const getDuration = require('get-audio-duration');
    const durationInSeconds = await getDuration.getAudioDurationInSeconds(req.file.path);
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = Math.floor(durationInSeconds % 60);
    const duration = `${minutes} min ${seconds} sec`;

    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      folder: 'astravon/podcasts',
      format: 'mp3'
    });

    fs.unlinkSync(req.file.path);

    res.json({ 
      url: result.secure_url,
      public_id: result.public_id,
      duration: duration // Incluimos la duración en la respuesta
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor API corriendo en http://localhost:${PORT}`);
});