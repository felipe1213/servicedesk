// Manual mock for pdf-parse so jest.mock('pdf-parse') produces a jest.fn()
const pdfParse = jest.fn();
module.exports = pdfParse;
