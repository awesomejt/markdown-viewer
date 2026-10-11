// Command mdv serves the markdown viewer web application.
package main

var version = "dev"

func main() {
	println(versionString())
}

func versionString() string {
	return "mdv " + version
}
