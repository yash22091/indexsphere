#!/bin/bash

# IndexSphere Git Repository Initialization Script
# This script prepares the repository for GitHub

set -e

# Function to print output
print_status() {
    echo "[INFO] $1"
}

print_success() {
    echo "[SUCCESS] $1"
}

print_warning() {
    echo "[WARNING] $1"
}

print_error() {
    echo "[ERROR] $1"
}

print_info() {
    echo "[INFO] $1"
}

echo "Initializing IndexSphere Git Repository"
echo "=========================================="

# Check if Git is installed
print_status "Checking Git installation..."
if ! command -v git &> /dev/null; then
    print_error "Git is not installed"
    print_info "Install Git: sudo apt-get install git"
    exit 1
fi
print_success "Git is installed"

# Check if already a Git repository
if [ -d ".git" ]; then
    print_warning "This is already a Git repository"
    print_info "If you want to reinitialize, delete .git folder first"
    exit 1
fi

# Initialize Git repository
print_status "Initializing Git repository..."
git init
print_success "Git repository initialized"

# Set up Git configuration if needed
print_status "Checking Git configuration..."
if ! git config user.name > /dev/null 2>&1; then
    print_warning "Git user.name not configured"
    echo -n "Enter your name: "
    read -r username
    git config user.name "$username"
    print_success "Set user.name to: $username"
fi

if ! git config user.email > /dev/null 2>&1; then
    print_warning "Git user.email not configured"
    echo -n "Enter your email: "
    read -r email
    git config user.email "$email"
    print_success "Set user.email to: $email"
fi

# Add all files
print_status "Adding files to Git..."
git add .
print_success "All files added to staging area"

# Create initial commit
print_status "Creating initial commit..."
git commit -m "Initial commit: IndexSphere production-ready application

- Complete Next.js application with authentication
- Production Docker setup with multi-stage builds
- Automated scripts for build, start, stop, and verification
- Comprehensive documentation and contribution guidelines
- Self-contained repository ready for deployment"

print_success "Initial commit created"

echo ""
echo "[SUCCESS] Git Repository Ready!"
echo "======================="
echo ""
print_success "Your IndexSphere repository has been initialized"
echo ""
print_info "Repository status:"
echo "  📁 Repository:     Initialized"
echo "  📝 Files:          All added and committed"
echo "  🔧 Configuration:  Complete"
echo ""
print_warning "Next steps to publish on GitHub:"
echo ""
echo "1. Create a new repository on GitHub (https://github.com/new)"
echo "2. Copy the repository URL"
echo "3. Run these commands:"
echo ""
echo "   git remote add origin <your-repository-url>"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
print_info "Example:"
echo "   git remote add origin https://github.com/yourusername/indexsphere.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
print_success "Your repository is ready for GitHub! 🚀"
echo ""
