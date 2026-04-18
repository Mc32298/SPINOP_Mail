const { ipcRenderer } = require('electron')

// Listen for mouse movements anywhere inside the email window
document.addEventListener('mouseover', (event) => {
  // Check if the mouse is touching an 'a' (link) tag
  const link = event.target.closest('a')
  if (link && link.href) {
    // Send the raw link back to our main process
    ipcRenderer.send('custom-hover-link', link.href)
  }
})

// Clear the bar when the mouse moves away from the link
document.addEventListener('mouseout', (event) => {
  const link = event.target.closest('a')
  if (link) {
    ipcRenderer.send('custom-hover-link', '') 
  }
})